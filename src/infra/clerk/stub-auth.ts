import type { AuthPort, AuthIdentity } from "@/modules/auth";
import { ok, UserId } from "@/shared";

/** A fixed dev identity so the shell renders signed-in with no Clerk keys. */
const DEV_IDENTITY: AuthIdentity = {
  userId: UserId("dev-user"),
  email: "dev@skillbuilder.local",
};

/**
 * Offline AuthPort — always returns a dev identity. Lets the authoring shell
 * run end-to-end before Clerk is wired (ARCHITECTURE §4 stack).
 */
export function createStubAuth(identity: AuthIdentity = DEV_IDENTITY): AuthPort {
  return {
    async currentIdentity() {
      return ok(identity);
    },
  };
}
