import { auth } from "@clerk/nextjs/server";
import type { Tier } from "@/modules/usage";
import type { UserId } from "@/shared";

export type TierResolver = (userId: UserId) => Promise<Tier>;

/**
 * Clerk Billing is the source of paid-plan truth in v1. The gateway only needs
 * the domain tier, so this adapter keeps Clerk's beta billing API at the edge.
 */
export function createClerkTierResolver(proPlanSlug: string): TierResolver {
  return async () => {
    try {
      const { has } = await auth();
      return has({ plan: proPlanSlug }) ? "pro" : "free";
    } catch {
      return "free";
    }
  };
}
