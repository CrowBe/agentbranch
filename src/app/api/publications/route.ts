import { createHash } from "node:crypto";
import { z } from "zod";
import { publishSkillVersion } from "@/modules/publication";
import { serializeSkillMd } from "@/modules/skill";
import { getContainer } from "@/server/container";
import { domainError, isErr, SkillId } from "@/shared";
import { parseJsonRequest, invalidRequestResponse } from "../_shared/request-body";
import { domainErrorResponse, validationMessage } from "../_shared/skill-request";

export const runtime = "nodejs";

const publishRequestSchema = z.object({
  skillId: z.string().min(1),
  slug: z.object({
    owner: z.string().min(1),
    name: z.string().min(1),
  }),
});

/**
 * Open publishing (ARCHITECTURE §9.1): publish records the user's main version
 * as a public, installable publication. Safety ratings remain advisory badge
 * data and are never required here.
 */
export async function POST(request: Request): Promise<Response> {
  const body = await parseJsonRequest(request);
  if (!body.ok) return body.response;

  const parsed = publishRequestSchema.safeParse(body.value);
  if (!parsed.success) return invalidRequestResponse(validationMessage(parsed.error));

  const container = getContainer();
  const identity = await container.auth.currentIdentity();
  if (!identity.ok) return domainErrorResponse(identity.error);
  if (identity.value === null) {
    return Response.json({ error: "Sign in to publish a skill." }, { status: 401 });
  }

  const skill = await container.skills.findById(SkillId(parsed.data.skillId), identity.value.userId);
  if (isErr(skill)) return domainErrorResponse(skill.error);
  if (!skill.value?.latestVersionId) {
    return domainErrorResponse(domainError("not_found", `No skill ${parsed.data.skillId}.`));
  }

  const publication = await publishSkillVersion(
    {
      publications: container.publications,
      requestRateLimiter: container.requestRateLimiter,
    },
    {
      publisherId: identity.value.userId,
      skillId: skill.value.id,
      skillVersionId: skill.value.latestVersionId,
      slug: parsed.data.slug,
      tier: "published",
      contentHash: contentHashForSkill(skill.value.source),
    },
  );
  if (isErr(publication)) return domainErrorResponse(publication.error);

  return Response.json(
    {
      publication: {
        id: publication.value.id,
        slug: publication.value.slug,
        tier: publication.value.tier,
        skillId: publication.value.skillId,
        skillVersionId: publication.value.skillVersionId,
        contentHash: publication.value.contentHash,
        createdAt: publication.value.createdAt.toISOString(),
      },
    },
    { status: 201 },
  );
}

function contentHashForSkill(source: Parameters<typeof serializeSkillMd>[0]): string {
  return `sha256:${createHash("sha256").update(serializeSkillMd(source)).digest("hex")}`;
}
