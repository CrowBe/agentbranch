/**
 * The public tap repo — the installation source published skills live in
 * (ARCHITECTURE §9.1). The repo is product identity, not deployment config:
 * docs, the profile page's install copy, and the report path all name it.
 */
export const TAP_REPOSITORY = "CrowBe/agentbranch-tap";
export const TAP_REPOSITORY_URL = `https://github.com/${TAP_REPOSITORY}`;

/**
 * The in-app report path (ARCHITECTURE §9.1 takedown model): a deep link into
 * the tap repo's "Report a skill" issue form with the slug + content hash the
 * form requires prefilled, so a report always names the exact bytes it is about.
 */
export function tapSkillReportUrl(slug: string, contentHash: string): string {
  const params = new URLSearchParams({
    template: "report-skill.yml",
    slug,
    content_hash: contentHash,
  });
  return `${TAP_REPOSITORY_URL}/issues/new?${params.toString()}`;
}

/**
 * Port: ask the public tap repo's automation to sync from the snapshot now.
 * Publish is the fast path (a dispatch on every successful publish); the tap
 * repo's scheduled reconciliation sweep covers a missed or failed dispatch, so
 * the request is best-effort by design — "unavailable" is a deferral, never a
 * publish failure.
 */
export type TapSyncTrigger = {
  requestSync(): Promise<TapSyncOutcome>;
};

export type TapSyncOutcome = "requested" | "unavailable";
