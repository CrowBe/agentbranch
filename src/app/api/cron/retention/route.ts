import { getContainer } from "@/server/container";
import { isErr, OPEN_DRAFTS_MAX, SKILL_VERSION_MAX } from "@/shared";
import { domainErrorResponse } from "../../_shared/skill-request";

export const runtime = "nodejs";

/**
 * The retention job — the platform's first scheduled trigger (Vercel Cron;
 * see `vercel.json`). Runs daily, **off the write path**, so nothing is pruned
 * while a session is live (ARCHITECTURE §9.3). It keeps the latest
 * `SKILL_VERSION_MAX` revisions per draft and caps open drafts at
 * `OPEN_DRAFTS_MAX`, never touching the main lineage or any open draft's tip.
 *
 * Locked behind `CRON_SECRET` (Vercel sends it as a bearer token); with no
 * secret set the route is closed — fail-safe, like the model-console allowlist.
 */
export async function GET(request: Request): Promise<Response> {
  const container = getContainer();
  const { cronSecret } = container.config;
  if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return Response.json({ error: "Not authorized." }, { status: 401 });
  }

  const report = await container.skillRetention.prune({
    keepPerBranch: SKILL_VERSION_MAX,
    maxOpenDrafts: OPEN_DRAFTS_MAX,
  });
  if (isErr(report)) return domainErrorResponse(report.error);

  return Response.json({ ok: true, ...report.value });
}
