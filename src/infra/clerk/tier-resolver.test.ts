import { describe, expect, it, vi } from "vitest";
import { UserId } from "@/shared";
import { createClerkTierResolver } from "./tier-resolver";

const clerkMocks = vi.hoisted(() => ({
  auth: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: clerkMocks.auth,
}));

describe("Clerk tier resolver", () => {
  it("maps users with the configured plan to pro", async () => {
    clerkMocks.auth.mockResolvedValueOnce({ has: vi.fn(() => true) });

    const tierFor = createClerkTierResolver("pro");

    await expect(tierFor(UserId("user_123"))).resolves.toBe("pro");
  });

  it("defaults to free when the user does not have the Pro plan", async () => {
    clerkMocks.auth.mockResolvedValueOnce({ has: vi.fn(() => false) });

    const tierFor = createClerkTierResolver("pro");

    await expect(tierFor(UserId("user_123"))).resolves.toBe("free");
  });

  it("defaults to free when Clerk Billing is unavailable", async () => {
    clerkMocks.auth.mockRejectedValueOnce(new Error("billing unavailable"));

    const tierFor = createClerkTierResolver("pro");

    await expect(tierFor(UserId("user_123"))).resolves.toBe("free");
  });
});
