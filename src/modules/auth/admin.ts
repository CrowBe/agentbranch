import type { AuthIdentity } from "./auth.types";

/**
 * Who may use instance-wide admin surfaces (the model console — provider/model
 * selection + credentials apply to the whole running instance, ARCHITECTURE §4
 * routing). An allowlist, not a role system: an identity is an admin when its
 * Clerk user id or its (case-insensitive) email is listed. Sourced from env
 * (`AGENTBRANCH_ADMIN_USER_IDS` / `AGENTBRANCH_ADMIN_EMAILS`) via config.
 */
export type AdminPolicy = {
  readonly userIds: readonly string[];
  readonly emails: readonly string[];
};

/** True when the identity is on the admin allowlist. Pure — emails compared lower-case. */
export function isAdmin(identity: AuthIdentity, policy: AdminPolicy): boolean {
  if (policy.userIds.includes(identity.userId)) return true;
  const email = identity.email.trim().toLowerCase();
  return email.length > 0 && policy.emails.includes(email);
}
