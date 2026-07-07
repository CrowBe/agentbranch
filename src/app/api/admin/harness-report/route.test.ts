import { beforeEach, describe, expect, it, vi } from "vitest";
import { ok, UserId } from "@/shared";
import { GET } from "./route";

const currentIdentity = vi.fn();
const listEvalRuns = vi.fn();
const listTestRuns = vi.fn();
const config = {
  flags: { hasAuth: true, hasDatabase: false, hasModel: false },
  admin: { userIds: ["admin-1"], emails: [] },
};

vi.mock("@/server/container", () => ({
  getContainer: () => ({
    auth: { currentIdentity },
    config,
    evalRuns: { listForAnalysis: listEvalRuns },
    testRuns: { listForAnalysis: listTestRuns },
  }),
}));

function get(query = ""): Promise<Response> {
  return GET(new Request(`https://example.test/api/admin/harness-report${query}`));
}

beforeEach(() => {
  currentIdentity.mockReset();
  listEvalRuns.mockReset().mockResolvedValue(ok([]));
  listTestRuns.mockReset().mockResolvedValue(ok([]));
  config.flags.hasAuth = true;
});

describe("harness-report route", () => {
  it("401s a signed-out caller", async () => {
    currentIdentity.mockResolvedValue(ok(null));
    expect((await get()).status).toBe(401);
    expect(listEvalRuns).not.toHaveBeenCalled();
  });

  it("403s a signed-in non-admin — the aggregate read never runs", async () => {
    currentIdentity.mockResolvedValue(ok({ userId: UserId("rando"), email: "r@acme.test" }));
    expect((await get()).status).toBe(403);
    expect(listEvalRuns).not.toHaveBeenCalled();
    expect(listTestRuns).not.toHaveBeenCalled();
  });

  it("renders the report for an admin, offline, from both aggregate reads", async () => {
    currentIdentity.mockResolvedValue(ok({ userId: UserId("admin-1"), email: "a@acme.test" }));
    const response = await get();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.headline).toContain("No harness recommendations");
    expect(body.cohort).toMatchObject({ evalRuns: 0, testRuns: 0 });
    expect(body.recommendations).toEqual([]);
    expect(listEvalRuns).toHaveBeenCalledWith({});
    expect(listTestRuns).toHaveBeenCalledWith({});
  });

  it("passes limit and since through to the aggregate reads", async () => {
    currentIdentity.mockResolvedValue(ok({ userId: UserId("admin-1"), email: "a@acme.test" }));
    await get("?limit=25&since=2026-07-01T00:00:00.000Z");
    expect(listEvalRuns).toHaveBeenCalledWith({
      limit: 25,
      since: new Date("2026-07-01T00:00:00.000Z"),
    });
  });
});
