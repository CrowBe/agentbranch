import { describe, expect, it } from "vitest";
import { UserId } from "@/shared";
import { isAdmin } from "./admin";
import type { AuthIdentity } from "./auth.types";

const identity = (userId: string, email: string): AuthIdentity => ({
  userId: UserId(userId),
  email,
});

describe("isAdmin", () => {
  it("matches an allowlisted user id", () => {
    expect(isAdmin(identity("u-1", "a@x.test"), { userIds: ["u-1"], emails: [] })).toBe(true);
  });

  it("matches an allowlisted email case-insensitively", () => {
    expect(isAdmin(identity("u-1", "Admin@X.Test"), { userIds: [], emails: ["admin@x.test"] })).toBe(
      true,
    );
  });

  it("denies an identity on neither list", () => {
    expect(isAdmin(identity("u-2", "b@x.test"), { userIds: ["u-1"], emails: ["a@x.test"] })).toBe(
      false,
    );
  });

  it("denies when the allowlists are empty (fail-safe)", () => {
    expect(isAdmin(identity("u-1", "a@x.test"), { userIds: [], emails: [] })).toBe(false);
  });

  it("does not treat an empty identity email as a match for an empty list entry", () => {
    expect(isAdmin(identity("u-1", ""), { userIds: [], emails: [] })).toBe(false);
  });
});
