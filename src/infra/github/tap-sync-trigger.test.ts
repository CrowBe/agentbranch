import { describe, expect, it, vi } from "vitest";
import {
  createDisabledTapSyncTrigger,
  createGithubTapSyncTrigger,
} from "./tap-sync-trigger";

describe("github tap sync trigger", () => {
  it("fires a publish repository_dispatch at the tap repo", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const trigger = createGithubTapSyncTrigger(
      { repository: "CrowBe/agentbranch-tap", token: "tap-token" },
      fetchImpl,
    );

    await expect(trigger.requestSync()).resolves.toBe("requested");

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.github.com/repos/CrowBe/agentbranch-tap/dispatches");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ event_type: "publish" }));
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer tap-token");
  });

  it("maps a rejected dispatch to unavailable, never a throw", async () => {
    const denied = createGithubTapSyncTrigger(
      { repository: "CrowBe/agentbranch-tap", token: "bad" },
      vi.fn().mockResolvedValue(new Response(null, { status: 404 })),
    );
    const offline = createGithubTapSyncTrigger(
      { repository: "CrowBe/agentbranch-tap", token: "tap-token" },
      vi.fn().mockRejectedValue(new Error("network down")),
    );

    await expect(denied.requestSync()).resolves.toBe("unavailable");
    await expect(offline.requestSync()).resolves.toBe("unavailable");
  });

  it("defers every request when disabled", async () => {
    await expect(createDisabledTapSyncTrigger().requestSync()).resolves.toBe("unavailable");
  });
});
