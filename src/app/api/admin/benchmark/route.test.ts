import { beforeEach, describe, expect, it, vi } from "vitest";
import { BenchmarkRunId, HarnessVersionId, ok, UserId } from "@/shared";
import { regressionBenchmarkSetHash } from "@/modules/regression-benchmark";
import { GET, POST } from "./route";

const currentIdentity = vi.fn();
const listRuns = vi.fn();
const recordRun = vi.fn();
const classify = vi.fn();
const config = {
  flags: { hasAuth: true, hasDatabase: false, hasModel: true },
  admin: { userIds: ["admin-1"], emails: [] },
};
const gateway = { hasModel: true, classify };

vi.mock("@/server/container", () => ({
  getContainer: () => ({
    auth: { currentIdentity },
    config,
    modelGateway: gateway,
    currentHarnessVersion: async () => ok({ id: HarnessVersionId("h1") }),
    benchmarkRuns: { list: listRuns, record: recordRun },
  }),
}));

beforeEach(() => {
  currentIdentity.mockReset();
  listRuns.mockReset().mockResolvedValue(ok([]));
  recordRun
    .mockReset()
    .mockImplementation(async (run) =>
      ok({ ...run, id: BenchmarkRunId("b1"), createdAt: new Date(0) }),
    );
  // Always silent: negatives pass, positives fail — a deterministic half score.
  classify.mockReset().mockResolvedValue(ok({ choice: null, rationale: "silent" }));
  gateway.hasModel = true;
  config.flags.hasAuth = true;
});

describe("benchmark route", () => {
  it("gates both methods behind the admin allowlist", async () => {
    currentIdentity.mockResolvedValue(ok(null));
    expect((await GET()).status).toBe(401);
    currentIdentity.mockResolvedValue(ok({ userId: UserId("rando"), email: "r@acme.test" }));
    expect((await GET()).status).toBe(403);
    expect((await POST()).status).toBe(403);
    expect(classify).not.toHaveBeenCalled();
  });

  it("GET returns the score-over-harness-versions view", async () => {
    currentIdentity.mockResolvedValue(ok({ userId: UserId("admin-1"), email: "a@acme.test" }));
    const run = (id: string, harnessVersionId: string, score: number) => ({
      id,
      harnessVersionId,
      benchmarkSetHash: regressionBenchmarkSetHash,
      totalCases: 60,
      passedCases: Math.round(score * 60),
      score,
      perSkill: [],
      createdAt: new Date(0).toISOString(),
    });
    listRuns.mockResolvedValue(ok([run("b2", "h2", 0.9), run("b1", "h1", 0.8)]));

    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.benchmarkSetHash).toBe(regressionBenchmarkSetHash);
    expect(body.harnessVersions.map((v: { harnessVersionId: string }) => v.harnessVersionId)).toEqual([
      "h2",
      "h1",
    ]);
  });

  it("POST scores the frozen set and records the run pinned to the current harness version", async () => {
    currentIdentity.mockResolvedValue(ok({ userId: UserId("admin-1"), email: "a@acme.test" }));
    const response = await POST();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.id).toBe("b1");
    expect(body.harnessVersionId).toBe("h1");
    expect(body.benchmarkSetHash).toBe(regressionBenchmarkSetHash);
    expect(body.totalCases).toBeGreaterThan(0);
    expect(recordRun).toHaveBeenCalledWith(
      expect.objectContaining({ harnessVersionId: "h1" }),
    );
  });

  it("POST fails 503 offline before any recording", async () => {
    currentIdentity.mockResolvedValue(ok({ userId: UserId("admin-1"), email: "a@acme.test" }));
    gateway.hasModel = false;
    expect((await POST()).status).toBe(503);
    expect(recordRun).not.toHaveBeenCalled();
  });
});
