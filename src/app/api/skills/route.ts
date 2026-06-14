import { getContainer } from "@/server/container";
import { isErr } from "@/shared";
import { domainErrorResponse } from "../_shared/skill-request";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const container = getContainer();
  const identity = await container.auth.currentIdentity();
  if (!identity.ok) return domainErrorResponse(identity.error);
  if (identity.value === null) {
    return Response.json({ error: "Sign in to list skills." }, { status: 401 });
  }

  const skills = await container.skills.listByUser(identity.value.userId);
  if (isErr(skills)) return domainErrorResponse(skills.error);

  return Response.json({
    skills: skills.value.map((skill) => ({
      id: skill.id,
      name: skill.source.frontmatter.name,
      description: skill.source.frontmatter.description,
      latestRevision: skill.latestRevision,
      createdAt: skill.createdAt.toISOString(),
      updatedAt: skill.updatedAt.toISOString(),
    })),
  });
}
