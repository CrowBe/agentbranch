import { getContainer } from "@/server/container";
import { isAdmin } from "@/modules/auth";
import { domainErrorResponse } from "@/server/http";

/**
 * Authorize an admin caller; null when they may proceed. 401 signed-out, 403 a
 * non-admin while auth is configured. Open on a no-auth dev box; locked when
 * auth is on but no admin allowlist is set (fail-safe). The shared gate for
 * instance-wide admin surfaces — the model console and the harness improvement
 * loop's report + benchmark routes (ARCHITECTURE §9).
 */
export async function requireAdmin(messages: {
  readonly signIn: string;
  readonly restricted: string;
}): Promise<Response | null> {
  const container = getContainer();
  const identity = await container.auth.currentIdentity();
  if (!identity.ok) return domainErrorResponse(identity.error);
  if (identity.value === null) {
    return Response.json({ error: messages.signIn }, { status: 401 });
  }
  if (!container.config.flags.hasAuth) return null;
  if (isAdmin(identity.value, container.config.admin)) return null;
  return Response.json({ error: messages.restricted }, { status: 403 });
}
