import { beforeEach, describe, expect, it, vi } from "vitest";
import { domainError, ok, UserId } from "@/shared";
import { DELETE, GET } from "./route";

const currentIdentity = vi.fn();
const deleteSkill = vi.fn();
const findById = vi.fn();
const listVersions = vi.fn();
const restoreSkill = vi.fn();

vi.mock("@/server/container", () => ({
  getContainer: () => ({
    auth: { currentIdentity },
    skills: { delete: deleteSkill, findById, listVersions, restore: restoreSkill },
  }),
}));

describe("GET /api/skills/:id", () => {
  beforeEach(() => {
    currentIdentity.mockReset();
    findById.mockReset();
    listVersions.mockReset();
  });

  it("loads an owned skill with its versions", async () => {
    currentIdentity.mockResolvedValue(ok({ userId: UserId("user-1") }));
    findById.mockResolvedValue(ok({
      id: "skill-1",
      source: {
        frontmatter: { name: "inbox-triage", description: "Sort mail.", extra: {} },
        body: "# Goal",
      },
      latestRevision: 2,
      latestVersionId: "version-2",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    }));
    listVersions.mockResolvedValue(ok([
      {
        id: "version-2",
        revision: 2,
        source: {
          frontmatter: { name: "inbox-triage", description: "Sort mail better.", extra: {} },
          body: "# Goal\n\nImprove it.",
        },
        lintSummary: { score: 76, grade: "B", counts: { error: 0, warn: 2, info: 0 } },
        createdAt: new Date("2026-01-02T00:00:00.000Z"),
      },
    ]));

    const response = await GET(new Request("https://example.test/api/skills/skill-1"), {
      params: { id: "skill-1" },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      skill: {
        id: "skill-1",
        source: {
          frontmatter: { name: "inbox-triage", description: "Sort mail.", extra: {} },
          body: "# Goal",
        },
        latestRevision: 2,
        latestVersionId: "version-2",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z",
      },
      versions: [
        {
          id: "version-2",
          revision: 2,
          source: {
            frontmatter: { name: "inbox-triage", description: "Sort mail better.", extra: {} },
            body: "# Goal\n\nImprove it.",
          },
          lintSummary: { score: 76, grade: "B", counts: { error: 0, warn: 2, info: 0 } },
          createdAt: "2026-01-02T00:00:00.000Z",
        },
      ],
    });
    expect(findById).toHaveBeenCalledWith("skill-1", "user-1");
    expect(listVersions).toHaveBeenCalledWith("skill-1", "user-1");
  });

  it("returns not found for another user's skill", async () => {
    currentIdentity.mockResolvedValue(ok({ userId: UserId("user-1") }));
    findById.mockResolvedValue(ok(null));

    const response = await GET(new Request("https://example.test/api/skills/skill-2"), {
      params: { id: "skill-2" },
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Skill not found.",
      code: "not_found",
    });
    expect(listVersions).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/skills/:id", () => {
  beforeEach(() => {
    currentIdentity.mockReset();
    deleteSkill.mockReset();
  });

  it("deletes the owned skill", async () => {
    currentIdentity.mockResolvedValue(ok({ userId: UserId("user-1") }));
    deleteSkill.mockResolvedValue(ok(undefined));

    const response = await DELETE(new Request("https://example.test/api/skills/skill-1"), {
      params: { id: "skill-1" },
    });

    expect(response.status).toBe(204);
    expect(deleteSkill).toHaveBeenCalledWith("skill-1", "user-1");
  });

  it("returns not found when the skill is missing or belongs to another user", async () => {
    currentIdentity.mockResolvedValue(ok({ userId: UserId("user-1") }));
    deleteSkill.mockResolvedValue({
      ok: false,
      error: domainError("not_found", "No skill skill-1."),
    });

    const response = await DELETE(new Request("https://example.test/api/skills/skill-1"), {
      params: { id: "skill-1" },
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "No skill skill-1.",
      code: "not_found",
    });
  });

  it("requires a signed-in user", async () => {
    currentIdentity.mockResolvedValue(ok(null));

    const response = await DELETE(new Request("https://example.test/api/skills/skill-1"), {
      params: { id: "skill-1" },
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Sign in to delete a skill." });
    expect(deleteSkill).not.toHaveBeenCalled();
  });
});
