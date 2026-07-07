import type { ModelGateway } from "@/modules/model-gateway";
import { distractorLibrary, runBatteryCases } from "@/modules/triggering-eval";
import type { EvaluationObserver } from "@/modules/skill-analysis";
import { domainError, err, isErr, ok, type DomainError, type Result } from "@/shared";
import { regressionBenchmarkSet, regressionBenchmarkSetHash } from "./benchmark-set";
import type { BenchmarkScore, BenchmarkSkillScore } from "./benchmark.types";

/**
 * Score the triggering eval against the frozen set: every corpus skill's
 * curated battery runs through the same competitive selection the triggering
 * eval uses — so the score moves when the harness (distractor library, prompt
 * framing, classify method) moves, never because the test drifted. Spends with
 * a `platform` tag: measuring our own harness is our cost, never a user's.
 *
 * The corpus skills *are* the distractor library, so each candidate is scored
 * against the field minus itself.
 */
export async function runRegressionBenchmark(
  gateway: ModelGateway,
  options: { readonly observer?: EvaluationObserver } = {},
): Promise<Result<BenchmarkScore, DomainError>> {
  if (!gateway.hasModel) {
    return err(
      domainError(
        "model_unavailable",
        "The regression benchmark needs a model connection to run.",
      ),
    );
  }

  const perSkill: BenchmarkSkillScore[] = [];
  for (const entry of regressionBenchmarkSet) {
    options.observer?.({ kind: "progress", message: `Scoring ${entry.name}.` });
    const cases = await runBatteryCases(
      { name: entry.name, description: entry.description },
      entry.battery,
      gateway,
      { kind: "platform", reason: "regression-benchmark" },
      {
        distractors: distractorLibrary.filter((d) => d.name !== entry.name),
        observer: options.observer,
      },
    );
    if (isErr(cases)) return cases;
    perSkill.push({
      corpusEntryId: entry.corpusEntryId,
      contentHash: entry.contentHash,
      totalCases: cases.value.length,
      passedCases: cases.value.filter((c) => c.pass).length,
    });
  }

  const totalCases = perSkill.reduce((sum, skill) => sum + skill.totalCases, 0);
  const passedCases = perSkill.reduce((sum, skill) => sum + skill.passedCases, 0);
  return ok({
    benchmarkSetHash: regressionBenchmarkSetHash,
    totalCases,
    passedCases,
    score: totalCases === 0 ? 0 : Math.round((passedCases / totalCases) * 10_000) / 10_000,
    perSkill,
  });
}
