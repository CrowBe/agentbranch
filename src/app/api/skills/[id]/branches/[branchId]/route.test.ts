import { beforeEach, describe, expect, it, vi } from "vitest";
import { domainError, ok, UserId } from "@/shared";
import { DELETE } from "./route";

const currentIdentity = vi.fn();
const discardBranch = vi.fn();

vi.mock("@/server/container", () => ({
  getContainer: () => ({
    auth: { currentIdentity },
    skills: { discardBranch },
  }),
}));

describe("DELETE /api/skills/:id/branches/:branchId", () => {
  beforeEach(() => {
    currentIdentity.mockReset();
    discardBranch.mockReset();
  });

  it("discards a draft", async () => {
    currentIdentity.mockResolvedValue(ok({ userId: UserId("user-1") }));
    discardBranch.mockResolvedValue(ok(undefined));

    const response = await DELETE(
      new Request("https://example.test/api/skills/skill-1/branches/branch-1", { method: "DELETE" }),
      { params: { id: "skill-1", branchId: "branch-1" } },
    );

    expect(response.status).toBe(204);
    expect(discardBranch).toHaveBeenCalledWith({ id: "skill-1", userId: "user-1", branchId: "branch-1" });
  });

  it("refuses to discard the main version", async () => {
    currentIdentity.mockResolvedValue(ok({ userId: UserId("user-1") }));
    discardBranch.mockResolvedValue({
      ok: false,
      error: domainError("invalid_operation", "The main version's draft cannot be discarded."),
    });

    const response = await DELETE(
      new Request("https://example.test/api/skills/skill-1/branches/branch-1", { method: "DELETE" }),
      { params: { id: "skill-1", branchId: "branch-1" } },
    );

    expect(response.status).toBe(409);
  });

  it("requires a signed-in user", async () => {
    currentIdentity.mockResolvedValue(ok(null));

    const response = await DELETE(
      new Request("https://example.test/api/skills/skill-1/branches/branch-1", { method: "DELETE" }),
      { params: { id: "skill-1", branchId: "branch-1" } },
    );

    expect(response.status).toBe(401);
    expect(discardBranch).not.toHaveBeenCalled();
  });
});
