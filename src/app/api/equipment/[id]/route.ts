import { getContainer } from "@/server/container";
import { domainErrorResponse } from "../../_shared/skill-request";

export const runtime = "nodejs";

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const container = getContainer();
  const identity = await container.auth.currentIdentity();
  if (!identity.ok) return domainErrorResponse(identity.error);
  if (!identity.value) return Response.json({ error: "Sign in to remove equipment." }, { status: 401 });
  const { id } = await context.params;
  const removed = await container.equipment.remove(id, identity.value.userId);
  return removed.ok ? new Response(null, { status: 204 }) : domainErrorResponse(removed.error);
}
