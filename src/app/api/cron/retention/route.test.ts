import { beforeEach, describe, expect, it, vi } from "vitest";
import { ok, OPEN_DRAFTS_MAX, SKILL_VERSION_MAX } from "@/shared";
import { GET } from "./route";

const prune = vi.fn();
let cronSecret: string | undefined;

vi.mock("@/server/container", () => ({
  getContainer: () => ({
    config: { cronSecret },
    skillRetention: { prune },
  }),
}));

const request = (auth?: string) =>
  new Request("https://app/api/cron/retention", auth ? { headers: { authorization: auth } } : undefined);

describe("GET /api/cron/retention", () => {
  beforeEach(() => {
    prune.mockReset();
    cronSecret = "s3cret";
  });

  it("runs the prune with the configured caps when the bearer token matches", async () => {
    prune.mockResolvedValue(ok({ prunedVersions: 3, discardedBranches: 1 }));

    const response = await GET(request("Bearer s3cret"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, prunedVersions: 3, discardedBranches: 1 });
    expect(prune).toHaveBeenCalledWith({ keepPerBranch: SKILL_VERSION_MAX, maxOpenDrafts: OPEN_DRAFTS_MAX });
  });

  it("rejects a wrong or missing token", async () => {
    const wrong = await GET(request("Bearer nope"));
    expect(wrong.status).toBe(401);
    const missing = await GET(request());
    expect(missing.status).toBe(401);
    expect(prune).not.toHaveBeenCalled();
  });

  it("is locked when no CRON_SECRET is set (fail-safe)", async () => {
    cronSecret = undefined;
    const response = await GET(request("Bearer "));
    expect(response.status).toBe(401);
    expect(prune).not.toHaveBeenCalled();
  });
});
