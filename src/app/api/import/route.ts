import { getContainer } from "@/server/container";
import { parseSkillMd } from "@/modules/skill";
import { createHeroArtifact, renderedRenderer, sourceRenderer } from "@/modules/hero";
import { isErr } from "@/shared";
import { domainErrorResponse } from "../_shared/skill-request";
import { invalidRequestResponse, parseTextRequest } from "../_shared/request-body";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const container = getContainer();

  const identity = await container.auth.currentIdentity();
  if (!identity.ok) return domainErrorResponse(identity.error);
  if (identity.value === null) {
    return Response.json({ error: "Sign in to import a skill." }, { status: 401 });
  }

  const body = await parseTextRequest(request);
  if (!body.ok) return body.response;

  const parsed = parseSkillMd(body.value);
  if (isErr(parsed)) {
    return invalidRequestResponse(
      `This doesn't look like a valid SKILL.md yet - ${parsed.error.message}`,
    );
  }

  const saved = await container.skills.create({
    userId: identity.value.userId,
    source: parsed.value,
  });
  if (isErr(saved)) return domainErrorResponse(saved.error);

  const artifact = createHeroArtifact(saved.value.source);
  return Response.json({
    skill: {
      id: saved.value.id,
      source: saved.value.source,
      latestRevision: saved.value.latestRevision,
    },
    rendered: renderedRenderer.render(artifact),
    source: sourceRenderer.render(artifact),
  });
}
