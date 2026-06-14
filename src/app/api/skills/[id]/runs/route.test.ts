import { beforeEach, describe, expect, it, vi } from "vitest";
import { ok, UserId } from "@/shared";
import { GET } from "./route";

const currentIdentity = vi.fn();
const findById = vi.fn();
const listTestRunsBySkill = vi.fn();
const listEvalRunsBySkill = vi.fn();

vi.mock("@/server/container", () => ({
  getContainer: () => ({
    auth: { currentIdentity },
    skills: { findById },
    testRuns: { listBySkill: listTestRunsBySkill },
    evalRuns: { listBySkill: listEvalRunsBySkill },
  }),
}));

describe("GET /api/skills/:id/runs", () => {
  beforeEach(() => {
    currentIdentity.mockReset();
    findById.mockReset();
    listTestRunsBySkill.mockReset();
    listEvalRunsBySkill.mockReset();
  });

  it("lists persisted runs for an owned skill", async () => {
    currentIdentity.mockResolvedValue(ok({ userId: UserId("user-1") }));
    findById.mockResolvedValue(ok({ id: "skill-1" }));
    listTestRunsBySkill.mockResolvedValue(ok([
      {
        id: "test-run-1",
        skillVersionId: "version-1",
        status: "completed",
        scenario: { prompt: "Sort inbox.", seedData: {} },
        transcript: [{ kind: "model", text: "Done." }],
        createdAt: new Date("2026-01-03T00:00:00.000Z"),
      },
    ]));
    listEvalRunsBySkill.mockResolvedValue(ok([
      {
        id: "eval-run-1",
        skillVersionId: "version-1",
        status: "passed",
        result: {
          kind: "triggering-eval",
          cases: [],
          passed: true,
          insight: { verdict: "good", summary: "Works.", findings: [], watch: [] },
        },
        createdAt: new Date("2026-01-04T00:00:00.000Z"),
      },
    ]));

    const response = await GET(new Request("https://example.test/api/skills/skill-1/runs"), {
      params: { id: "skill-1" },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      testRuns: [
        {
          id: "test-run-1",
          skillVersionId: "version-1",
          status: "completed",
          scenario: { prompt: "Sort inbox.", seedData: {} },
          transcript: [{ kind: "model", text: "Done." }],
          createdAt: "2026-01-03T00:00:00.000Z",
        },
      ],
      evalRuns: [
        {
          id: "eval-run-1",
          skillVersionId: "version-1",
          status: "passed",
          result: {
            kind: "triggering-eval",
            cases: [],
            passed: true,
            insight: { verdict: "good", summary: "Works.", findings: [], watch: [] },
          },
          createdAt: "2026-01-04T00:00:00.000Z",
        },
      ],
    });
    expect(findById).toHaveBeenCalledWith("skill-1", "user-1");
    expect(listTestRunsBySkill).toHaveBeenCalledWith("skill-1", "user-1");
    expect(listEvalRunsBySkill).toHaveBeenCalledWith("skill-1", "user-1");
  });

  it("returns not found before listing runs for another user's skill", async () => {
    currentIdentity.mockResolvedValue(ok({ userId: UserId("user-1") }));
    findById.mockResolvedValue(ok(null));

    const response = await GET(new Request("https://example.test/api/skills/skill-2/runs"), {
      params: { id: "skill-2" },
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Skill not found.",
      code: "not_found",
    });
    expect(listTestRunsBySkill).not.toHaveBeenCalled();
    expect(listEvalRunsBySkill).not.toHaveBeenCalled();
  });
});
