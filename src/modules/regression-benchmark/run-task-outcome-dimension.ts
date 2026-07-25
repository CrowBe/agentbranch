import type { ModelGateway } from "@/modules/model-gateway";
import type { EvaluationObserver } from "@/modules/skill-analysis";
import {
  taskOutcomeCorpus,
  taskOutcomeCorpusSetHash,
} from "@/modules/task-outcome-corpus";
import {
  runBatteryCases,
  validateTriggeringAttempts,
} from "@/modules/triggering-eval";
import {
  domainError,
  err,
  isErr,
  ok,
  type DomainError,
  type Result,
} from "@/shared";
import type {
  BenchmarkDimensionEntryScore,
  TaskOutcomeBenchmarkDimensionScore,
} from "./benchmark.types";

/** Scores the frozen task-outcome corpus through the shared JSON grader. */
export async function runTaskOutcomeBenchmarkDimension(
  gateway: ModelGateway,
  options: {
    readonly observer?: EvaluationObserver;
    readonly attempts?: number;
  } = {},
): Promise<Result<TaskOutcomeBenchmarkDimensionScore, DomainError>> {
  const attempts = validateTriggeringAttempts(options.attempts);
  if (isErr(attempts)) return attempts;
  if (!gateway.hasModel) {
    return err(domainError(
      "model_unavailable",
      "The task-outcome benchmark dimension is model-bearing and needs a model connection.",
    ));
  }

  const entries: BenchmarkDimensionEntryScore[] = [];
  for (const entry of taskOutcomeCorpus) {
    options.observer?.({
      kind: "progress",
      message: `Scoring model-bearing task outcome: ${entry.name}.`,
    });
    const result = await runBatteryCases(
      { name: entry.name, description: entry.description },
      [entry.case],
      gateway,
      { kind: "platform", reason: "regression-benchmark-task-outcome" },
      { distractors: [], observer: options.observer, attempts: options.attempts },
    );
    if (isErr(result)) return result;
    entries.push({
      corpusEntryId: entry.id,
      contentHash: entry.contentHash,
      passed: result.value.every((score) => score.pass),
    });
  }

  const passedCases = entries.filter((entry) => entry.passed).length;
  return ok({
    benchmarkSetHash: taskOutcomeCorpusSetHash,
    totalCases: entries.length,
    passedCases,
    score: entries.length === 0 ? 0 : Math.round((passedCases / entries.length) * 10_000) / 10_000,
    entries,
    method: {
      kind: "model",
      grader: "json-output",
      graderVersion: 1,
      method: "generate-then-schema-validate",
      methodVersion: 1,
    },
  });
}
