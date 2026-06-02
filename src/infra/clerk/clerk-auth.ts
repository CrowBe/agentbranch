import { auth, currentUser } from "@clerk/nextjs/server";
import type { AuthPort } from "@/modules/auth";
import { ok, err, UserId, domainError } from "@/shared";

/**
 * Clerk-backed AuthPort (real). OAuth-only (Google + GitHub), so identities
 * always arrive verified. Server-only — used behind the port so the rest of the
 * app never imports Clerk.
 */
export function createClerkAuth(): AuthPort {
  return {
    async currentIdentity() {
      try {
        const { userId } = await auth();
        if (!userId) return ok(null);
        const user = await currentUser();
        const email = user?.primaryEmailAddress?.emailAddress ?? user?.emailAddresses[0]?.emailAddress;
        if (!email) return ok({ userId: UserId(userId), email: "" });
        return ok({ userId: UserId(userId), email });
      } catch (cause) {
        return err(domainError("auth_failed", "Could not resolve the current identity.", cause));
      }
    },
  };
}
