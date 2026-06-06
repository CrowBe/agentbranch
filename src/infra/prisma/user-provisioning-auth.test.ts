import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import type { AuthPort } from "@/modules/auth";
import { ok, err, UserId, domainError } from "@/shared";
import { createUserProvisioningAuth } from "./user-provisioning-auth";

describe("createUserProvisioningAuth", () => {
  it("upserts the signed-in user before returning identity", async () => {
    const upsert = vi.fn().mockResolvedValue({});
    const auth = createUserProvisioningAuth(signedIn("user_1", "ben@example.com"), prismaWithUser(upsert));

    const identity = await auth.currentIdentity();

    expect(identity.ok).toBe(true);
    expect(upsert).toHaveBeenCalledWith({
      where: { id: "user_1" },
      create: { id: "user_1", email: "ben@example.com" },
      update: { email: "ben@example.com" },
    });
  });

  it("does not touch Prisma when no user is signed in", async () => {
    const upsert = vi.fn();
    const auth = createUserProvisioningAuth(
      { currentIdentity: async () => ok(null) },
      prismaWithUser(upsert),
    );

    const identity = await auth.currentIdentity();

    expect(identity).toEqual(ok(null));
    expect(upsert).not.toHaveBeenCalled();
  });

  it("passes through auth failures without provisioning", async () => {
    const upsert = vi.fn();
    const failure = err(domainError("auth_failed", "nope"));
    const auth = createUserProvisioningAuth(
      { currentIdentity: async () => failure },
      prismaWithUser(upsert),
    );

    expect(await auth.currentIdentity()).toBe(failure);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("maps provisioning failures to persistence_failed", async () => {
    const upsert = vi.fn().mockRejectedValue(new Error("db down"));
    const auth = createUserProvisioningAuth(signedIn("user_1", "ben@example.com"), prismaWithUser(upsert));

    const identity = await auth.currentIdentity();

    expect(identity.ok).toBe(false);
    if (!identity.ok) {
      expect(identity.error.tag).toBe("persistence_failed");
    }
  });
});

function signedIn(userId: string, email: string): AuthPort {
  return {
    async currentIdentity() {
      return ok({ userId: UserId(userId), email });
    },
  };
}

function prismaWithUser(upsert: ReturnType<typeof vi.fn>): PrismaClient {
  return { user: { upsert } } as unknown as PrismaClient;
}
