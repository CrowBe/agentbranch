import { z } from "zod";
import { getContainer } from "@/server/container";
import { isErr, SkillId } from "@/shared";
import { domainErrorResponse, validationMessage } from "../../../_shared/skill-request";

export const runtime = "nodejs";

const restoreRequestSchema = z.object({
  revision: z.number().int().positive(),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> | { id: string } },
): Promise<Response> {
  const container = getContainer();
  const identity = await container.auth.currentIdentity();
  if (!identity.ok) return domainErrorResponse(identity.error);
  if (identity.value === null) {
    return Response.json({ error: "Sign in to restore a skill version." }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as unknown;
  const parsed = restoreRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: validationMessage(parsed.error) }, { status: 400 });
  }

  const params = await context.params;
  const restored = await container.skills.restore({
    id: SkillId(params.id),
    userId: identity.value.userId,
    revision: parsed.data.revision,
  });
  if (isErr(restored)) return domainErrorResponse(restored.error);

  return Response.json({
    skill: {
      id: restored.value.id,
      source: restored.value.source,
      latestRevision: restored.value.latestRevision,
      latestVersionId: restored.value.latestVersionId ?? null,
      createdAt: restored.value.createdAt.toISOString(),
      updatedAt: restored.value.updatedAt.toISOString(),
    },
  });
}
