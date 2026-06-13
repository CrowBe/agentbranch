import { getContainer } from "@/server/container";
import { SkillId } from "@/shared";
import { domainErrorResponse } from "../../_shared/skill-request";

export const runtime = "nodejs";

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
