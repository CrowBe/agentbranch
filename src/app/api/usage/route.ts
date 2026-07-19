import { formatQuotaMicros, quotaRemainingMicros } from "@/modules/usage";
import { getContainer } from "@/server/container";
import { domainErrorResponse } from "../_shared/skill-request";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const container = getContainer();
  const identity = await container.auth.currentIdentity();
  if (!identity.ok) return domainErrorResponse(identity.error);
  if (identity.value === null) return Response.json({ error: "Sign in to view usage." }, { status: 401 });

  const snapshot = await container.usage.get(identity.value.userId);
  if (!snapshot.ok) return domainErrorResponse(snapshot.error);
  const remainingMicros = quotaRemainingMicros(snapshot.value);
  return Response.json({ remainingMicros, label: `${formatQuotaMicros(remainingMicros)} free quota` });
}
