import { getContainer } from "@/server/container";
import {
  regressionBenchmarkSetHash,
  runRegressionBenchmark,
  type BenchmarkRun,
} from "@/modules/regression-benchmark";
import { isErr } from "@/shared";
import { domainErrorResponse } from "@/server/http";
import { requireAdmin } from "../../_shared/admin-gate";

export const runtime = "nodejs";

/**
 * The regression benchmark's admin surface (ARCHITECTURE §9, #123).
 * GET — score-over-harness-versions: every recorded run, grouped by the
 * harness version that produced it, so two manifest versions compare on the
 * same frozen set. POST — score the current harness now (`platform`-tagged
 * spend) and record the run; 503 offline, like every evaluation surface.
 */

const GATE_MESSAGES = {
  signIn: "Sign in to view the benchmark.",
  restricted: "The benchmark is restricted to administrators.",
} as const;

export async function GET(): Promise<Response> {
  const gate = await requireAdmin(GATE_MESSAGES);
  if (gate) return gate;

  const runs = await getContainer().benchmarkRuns.list();
  if (isErr(runs)) return domainErrorResponse(runs.error);

  return Response.json({
    benchmarkSetHash: regressionBenchmarkSetHash,
    harnessVersions: groupByHarnessVersion(runs.value),
  });
}

export async function POST(): Promise<Response> {
  const gate = await requireAdmin(GATE_MESSAGES);
  if (gate) return gate;

  const container = getContainer();
  const score = await runRegressionBenchmark(container.modelGateway);
  if (isErr(score)) return domainErrorResponse(score.error);

  const harnessVersion = await container.currentHarnessVersion();
  if (isErr(harnessVersion)) return domainErrorResponse(harnessVersion.error);

  const recorded = await container.benchmarkRuns.record({
    harnessVersionId: harnessVersion.value.id,
    ...score.value,
  });
  if (isErr(recorded)) return domainErrorResponse(recorded.error);
  return Response.json(recorded.value);
}

function groupByHarnessVersion(runs: readonly BenchmarkRun[]) {
  const groups = new Map<string, BenchmarkRun[]>();
  for (const run of runs) {
    const group = groups.get(run.harnessVersionId) ?? [];
    group.push(run);
    groups.set(run.harnessVersionId, group);
  }
  return [...groups.entries()].map(([harnessVersionId, versionRuns]) => ({
    harnessVersionId,
    runs: versionRuns,
  }));
}
