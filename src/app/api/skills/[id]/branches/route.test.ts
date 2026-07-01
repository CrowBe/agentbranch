import { beforeEach, describe, expect, it, vi } from "vitest";
import { ok, UserId } from "@/shared";
import { GET, POST } from "./route";

const currentIdentity = vi.fn();
const createBranch = vi.fn();
const listBranches = vi.fn();
const listBranchVersions = vi.fn();

vi.mock("@/server/container", () => ({
  getContainer: () => ({
    auth: { currentIdentity },
    skills: { createBranch, listBranches, listBranchVersions },
  }),
}));

const draftSource = {
  frontmatter: { name: "inbox-triage", description: "Sort mail.", extra: {} },
  body: "# Goal",
};

const head = {
  id: "version-1",
  revision: 1,
  source: draftSource,
  lintSummary: { score: 73, grade: "C", counts: { error: 0, warn: 2, info: 1 } },
  createdAt: new Date("2026-01-02T00:00:00.000Z"),
};

const branch = {
  id: "branch-1",
  isMain: false,
  status: "open" as const,
  ordinal: 1,
  headVersionId: "version-1",
  createdAt: new Date("2026-01-02T00:00:00.000Z"),
  updatedAt: new Date("2026-01-02T00:00:00.000Z"),
};

describe("/api/skills/:id/branches", () => {
  beforeEach(() => {
    currentIdentity.mockReset();
    createBranch.mockReset();
    listBranches.mockReset();
    listBranchVersions.mockReset();
  });

  it("starts a draft off the main version", async () => {
    currentIdentity.mockResolvedValue(ok({ userId: UserId("user-1") }));
    createBranch.mockResolvedValue(ok(branch));
    listBranchVersions.mockResolvedValue(ok([head]));

    const response = await POST(new Request("https://example.test/api/skills/skill-1/branches", { method: "POST" }), {
      params: { id: "skill-1" },
    });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      branch: {
        id: "branch-1",
        isMain: false,
        status: "open",
        ordinal: 1,
        revision: 1,
        source: draftSource,
        lintSummary: { score: 73, grade: "C", counts: { error: 0, warn: 2, info: 1 } },
      },
    });
    expect(createBranch).toHaveBeenCalledWith({ id: "skill-1", userId: "user-1" });
  });

  it("lists open drafts with a display summary", async () => {
    currentIdentity.mockResolvedValue(ok({ userId: UserId("user-1") }));
    listBranches.mockResolvedValue(ok([branch]));
    listBranchVersions.mockResolvedValue(ok([head]));

    const response = await GET(new Request("https://example.test/api/skills/skill-1/branches"), {
      params: { id: "skill-1" },
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { branches: unknown[] };
    expect(body.branches).toEqual([
      {
        id: "branch-1",
        isMain: false,
        status: "open",
        ordinal: 1,
        revision: 1,
        name: "inbox-triage",
        description: "Sort mail.",
        updatedAt: "2026-01-02T00:00:00.000Z",
      },
    ]);
  });

  it("requires a signed-in user", async () => {
    currentIdentity.mockResolvedValue(ok(null));

    const response = await POST(new Request("https://example.test/api/skills/skill-1/branches", { method: "POST" }), {
      params: { id: "skill-1" },
    });

    expect(response.status).toBe(401);
    expect(createBranch).not.toHaveBeenCalled();
  });
});
