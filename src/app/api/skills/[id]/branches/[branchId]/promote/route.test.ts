import { beforeEach, describe, expect, it, vi } from "vitest";
import { domainError, ok, UserId } from "@/shared";
import { POST } from "./route";

const currentIdentity = vi.fn();
const promoteBranch = vi.fn();

vi.mock("@/server/container", () => ({
  getContainer: () => ({
    auth: { currentIdentity },
    skills: { promoteBranch },
  }),
}));

describe("POST /api/skills/:id/branches/:branchId/promote", () => {
  beforeEach(() => {
    currentIdentity.mockReset();
    promoteBranch.mockReset();
  });

  it("sets a draft as the main version", async () => {
    currentIdentity.mockResolvedValue(ok({ userId: UserId("user-1") }));
    promoteBranch.mockResolvedValue(ok({
      id: "skill-1",
      source: { frontmatter: { name: "inbox-triage", description: "Sort mail.", extra: {} }, body: "# Goal" },
      latestRevision: 2,
      latestVersionId: "version-9",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-05T00:00:00.000Z"),
    }));

    const response = await POST(
      new Request("https://example.test/api/skills/skill-1/branches/branch-1/promote", { method: "POST" }),
      { params: { id: "skill-1", branchId: "branch-1" } },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      skill: {
        id: "skill-1",
        source: { frontmatter: { name: "inbox-triage", description: "Sort mail.", extra: {} }, body: "# Goal" },
        latestRevision: 2,
        lintSummary: {
          score: 70,
          grade: "C",
          counts: { error: 0, warn: 2, info: 2 },
          rules: [
            "body.examples.missing",
            "body.negative-scope.missing",
            "frontmatter.description.too-short",
            "metadata.category.missing",
          ],
        },
        latestVersionId: "version-9",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-05T00:00:00.000Z",
      },
    });
    expect(promoteBranch).toHaveBeenCalledWith({ id: "skill-1", userId: "user-1", branchId: "branch-1" });
  });

  it("surfaces a missing draft as not found", async () => {
    currentIdentity.mockResolvedValue(ok({ userId: UserId("user-1") }));
    promoteBranch.mockResolvedValue({ ok: false, error: domainError("not_found", "No draft branch-9.") });

    const response = await POST(
      new Request("https://example.test/api/skills/skill-1/branches/branch-9/promote", { method: "POST" }),
      { params: { id: "skill-1", branchId: "branch-9" } },
    );

    expect(response.status).toBe(404);
  });

  it("requires a signed-in user", async () => {
    currentIdentity.mockResolvedValue(ok(null));

    const response = await POST(
      new Request("https://example.test/api/skills/skill-1/branches/branch-1/promote", { method: "POST" }),
      { params: { id: "skill-1", branchId: "branch-1" } },
    );

    expect(response.status).toBe(401);
    expect(promoteBranch).not.toHaveBeenCalled();
  });
});
