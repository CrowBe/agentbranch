import { beforeEach, describe, expect, it, vi } from "vitest";
import { domainError, ok, UserId } from "@/shared";
import { POST } from "./route";

const currentIdentity = vi.fn();
const restoreSkill = vi.fn();

vi.mock("@/server/container", () => ({
  getContainer: () => ({
    auth: { currentIdentity },
    skills: { restore: restoreSkill },
  }),
}));

describe("POST /api/skills/:id/restore", () => {
  beforeEach(() => {
    currentIdentity.mockReset();
    restoreSkill.mockReset();
  });

  it("restores an owned revision as the new head", async () => {
    currentIdentity.mockResolvedValue(ok({ userId: UserId("user-1") }));
    restoreSkill.mockResolvedValue(ok({
      id: "skill-1",
      source: {
        frontmatter: { name: "inbox-triage", description: "Sort mail.", extra: {} },
        body: "# Goal",
      },
      latestRevision: 3,
      latestVersionId: "version-3",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-03T00:00:00.000Z"),
    }));

    const response = await POST(
      new Request("https://example.test/api/skills/skill-1/restore", {
        method: "POST",
        body: JSON.stringify({ revision: 1 }),
      }),
      { params: { id: "skill-1" } },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      skill: {
        id: "skill-1",
        source: {
          frontmatter: { name: "inbox-triage", description: "Sort mail.", extra: {} },
          body: "# Goal",
        },
        latestRevision: 3,
        lintSummary: {
          score: 73,
          grade: "C",
          counts: { error: 0, warn: 2, info: 1 },
          rules: [
            "body.examples.missing",
            "body.negative-scope.missing",
            "frontmatter.description.too-short",
          ],
        },
        latestVersionId: "version-3",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-03T00:00:00.000Z",
      },
    });
    expect(restoreSkill).toHaveBeenCalledWith({
      id: "skill-1",
      userId: "user-1",
      revision: 1,
    });
  });

  it("returns not found for a missing revision", async () => {
    currentIdentity.mockResolvedValue(ok({ userId: UserId("user-1") }));
    restoreSkill.mockResolvedValue({
      ok: false,
      error: domainError("not_found", "No revision 9 for skill skill-1."),
    });

    const response = await POST(
      new Request("https://example.test/api/skills/skill-1/restore", {
        method: "POST",
        body: JSON.stringify({ revision: 9 }),
      }),
      { params: { id: "skill-1" } },
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "No revision 9 for skill skill-1.",
      code: "not_found",
    });
  });

  it("validates the requested revision", async () => {
    currentIdentity.mockResolvedValue(ok({ userId: UserId("user-1") }));

    const response = await POST(
      new Request("https://example.test/api/skills/skill-1/restore", {
        method: "POST",
        body: JSON.stringify({ revision: 0 }),
      }),
      { params: { id: "skill-1" } },
    );

    expect(response.status).toBe(400);
    expect(restoreSkill).not.toHaveBeenCalled();
  });

  it("requires a signed-in user", async () => {
    currentIdentity.mockResolvedValue(ok(null));

    const response = await POST(
      new Request("https://example.test/api/skills/skill-1/restore", {
        method: "POST",
        body: JSON.stringify({ revision: 1 }),
      }),
      { params: { id: "skill-1" } },
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Sign in to restore a skill version." });
    expect(restoreSkill).not.toHaveBeenCalled();
  });
});
