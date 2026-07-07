import { getContainer } from "@/server/container";
import { runCapability } from "@/modules/skill-analysis";
import { harnessRecommendationCapability } from "@/modules/harness-recommendation";
import { isErr } from "@/shared";
import { domainErrorResponse } from "@/server/http";
import { requireAdmin } from "../../_shared/admin-gate";

export const runtime = "nodejs";

/**
 * The harness improvement loop's report surface (ARCHITECTURE §9, #122):
 * assemble the corpus cohort from the admin-gated aggregate reads, run the
 * harness-recommendation capability, return the rendered report. Static
 * correlation only — zero tokens, works offline. Admin-gated like the model
 * console; the response carries outcomes/features, never skill or prompt
 * content. Optional `?limit=` / `?since=` (ISO date) bound the cohort.
 */

const GATE_MESSAGES = {
  signIn: "Sign in to view the harness report.",
  restricted: "The harness report is restricted to administrators.",
} as const;

export async function GET(request: Request): Promise<Response> {
  const gate = await requireAdmin(GATE_MESSAGES);
  if (gate) return gate;

  const container = getContainer();
  const filter = readFilter(new URL(request.url));
  const [evalRuns, testRuns] = await Promise.all([
    container.evalRuns.listForAnalysis(filter),
    container.testRuns.listForAnalysis(filter),
  ]);
  if (isErr(evalRuns)) return domainErrorResponse(evalRuns.error);
  if (isErr(testRuns)) return domainErrorResponse(testRuns.error);

  const report = await runCapability(harnessRecommendationCapability, "report", {
    evalRuns: evalRuns.value,
    testRuns: testRuns.value,
  });
  if (isErr(report)) return domainErrorResponse(report.error);
  return Response.json(report.value);
}

function readFilter(url: URL): { limit?: number; since?: Date } {
  const limitParam = url.searchParams.get("limit");
  const sinceParam = url.searchParams.get("since");
  const limit = limitParam === null ? undefined : Number(limitParam);
  const since = sinceParam === null ? undefined : new Date(sinceParam);
  return {
    ...(limit !== undefined && Number.isFinite(limit) ? { limit } : {}),
    ...(since !== undefined && !Number.isNaN(since.getTime()) ? { since } : {}),
  };
}
