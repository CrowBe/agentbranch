import type { TapSyncOutcome, TapSyncTrigger } from "@/modules/publication";

type FetchLike = typeof fetch;

const DISPATCH_TIMEOUT_MS = 8_000;

/**
 * Production bot wiring for the tap publish pipeline (ARCHITECTURE §9.1): a
 * publish fires a `repository_dispatch` at the public tap repo, whose
 * publish-sync workflow applies the `/api/tap-repository` snapshot as an
 * auto-merged bot PR. Best-effort by contract — the tap repo's scheduled
 * reconciliation sweep covers a missed dispatch — so every failure mode maps
 * to "unavailable", never a thrown error into the publish path.
 */
export function createGithubTapSyncTrigger(
  config: { readonly repository: string; readonly token: string },
  fetchImpl: FetchLike = fetch,
): TapSyncTrigger {
  return {
    async requestSync(): Promise<TapSyncOutcome> {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), DISPATCH_TIMEOUT_MS);
      try {
        const response = await fetchImpl(
          `https://api.github.com/repos/${config.repository}/dispatches`,
          {
            method: "POST",
            headers: {
              accept: "application/vnd.github+json",
              authorization: `Bearer ${config.token}`,
              "content-type": "application/json",
              "x-github-api-version": "2022-11-28",
            },
            body: JSON.stringify({ event_type: "publish" }),
            signal: controller.signal,
          },
        );
        return response.status === 204 ? "requested" : "unavailable";
      } catch {
        return "unavailable";
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

/** Offline default: no tap repo configured, every sync request defers. */
export function createDisabledTapSyncTrigger(): TapSyncTrigger {
  return {
    async requestSync(): Promise<TapSyncOutcome> {
      return "unavailable";
    },
  };
}
