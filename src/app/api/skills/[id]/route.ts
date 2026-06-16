import { getContainer } from "@/server/container";
import { isErr, SkillId } from "@/shared";
import { domainErrorResponse } from "../../_shared/skill-request";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> | { id: string } },
): Promise<Response> {
  const container = getContainer();
  const identity = await container.auth.currentIdentity();
  if (!identity.ok) return domainErrorResponse(identity.error);
  if (identity.value === null) {
    return Response.json({ error: "Sign in to load a skill." }, { status: 401 });
  }

  const params = await context.params;
  const id = SkillId(params.id);
  const skill = await container.skills.findById(id, identity.value.userId);
  if (isErr(skill)) return domainErrorResponse(skill.error);
  if (!skill.value) return Response.json({ error: "Skill not found.", code: "not_found" }, { status: 404 });

  const versions = await container.skills.listVersions(id, identity.value.userId);
  if (isErr(versions)) return domainErrorResponse(versions.error);

  return Response.json({
    skill: {
      id: skill.value.id,
      source: skill.value.source,
      latestRevision: skill.value.latestRevision,
      latestVersionId: skill.value.latestVersionId ?? null,
      createdAt: skill.value.createdAt.toISOString(),
      updatedAt: skill.value.updatedAt.toISOString(),
    },
    versions: versions.value.map((version) => ({
      id: version.id,
      revision: version.revision,
      source: version.source,
      lintSummary: version.lintSummary ?? null,
      createdAt: version.createdAt.toISOString(),
    })),
  });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> | { id: string } },
): Promise<Response> {
  const container = getContainer();
  const identity = await container.auth.currentIdentity();
  if (!identity.ok) return domainErrorResponse(identity.error);
  if (identity.value === null) {
    return Response.json({ error: "Sign in to delete a skill." }, { status: 401 });
  }

  const params = await context.params;
  const result = await container.skills.delete(SkillId(params.id), identity.value.userId);

  return result.ok ? new Response(null, { status: 204 }) : domainErrorResponse(result.error);
}
