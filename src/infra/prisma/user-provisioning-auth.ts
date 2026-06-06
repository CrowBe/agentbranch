import type { PrismaClient } from "@prisma/client";
import type { AuthPort } from "@/modules/auth";
import { err, domainError } from "@/shared";

/**
 * Request-time user provisioning keeps Clerk as the identity source while
 * ensuring user-scoped Prisma writes have a parent row to reference.
 */
export function createUserProvisioningAuth(auth: AuthPort, prisma: PrismaClient): AuthPort {
  return {
    async currentIdentity() {
      const identity = await auth.currentIdentity();
      if (!identity.ok || identity.value === null) return identity;

      try {
        await prisma.user.upsert({
          where: { id: identity.value.userId },
          create: {
            id: identity.value.userId,
            email: identity.value.email,
          },
          update: {
            email: identity.value.email,
          },
        });
        return identity;
      } catch (cause) {
        return err(domainError("persistence_failed", "Could not provision the signed-in user.", cause));
      }
    },
  };
}
