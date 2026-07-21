import type { ModelGateway } from "@/modules/model-gateway";
import { distractorLibrary, runBatteryCases } from "@/modules/triggering-eval";
import { createResponseSchemaLintReport } from "@/modules/response-schema";
import { createToolContractLintReport } from "@/modules/tool-contract";
import { createLintReportForSource } from "@/modules/lint";
import type { EvaluationObserver } from "@/modules/skill-analysis";
import {
  domainError,
  err,
  isErr,
  ok,
  type DomainError,
  type Result,
} from "@/shared";
import {
  regressionBenchmarkSet,
  regressionBenchmarkSetHash,
  responseSchemaBenchmarkSet,
  responseSchemaBenchmarkSetHash,
  safetyBenchmarkSet,
  safetyBenchmarkSetHash,
  toolContractBenchmarkSet,
  toolContractBenchmarkSetHash,
} from "./benchmark-set";
import type {
  BenchmarkDimensionEntryScore,
  BenchmarkDimensionScore,
  BenchmarkScore,
  BenchmarkSkillScore,
} from "./benchmark.types";

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
  const passedCases = perSkill.reduce(
    (sum, skill) => sum + skill.passedCases,
    0,
  );
  return ok({
    benchmarkSetHash: regressionBenchmarkSetHash,
    totalCases,
    passedCases,
    score:
      totalCases === 0
        ? 0
        : Math.round((passedCases / totalCases) * 10_000) / 10_000,
    perSkill,
    dimensions: {
      responseSchema: scoreLintDimension(
        responseSchemaBenchmarkSet,
        responseSchemaBenchmarkSetHash,
        (entry) => createResponseSchemaLintReport(entry.source),
      ),
      toolContract: scoreLintDimension(
        toolContractBenchmarkSet,
        toolContractBenchmarkSetHash,
        (entry) => createToolContractLintReport(entry.source),
      ),
      safety: scoreSafetyDimension(),
    },
  });
}

function scoreLintDimension<
  Entry extends {
    readonly id: string;
    readonly contentHash: string;
    readonly expectedLint: {
      readonly grade: string;
      readonly findingCodes: readonly string[];
    };
  },
>(
  set: readonly Entry[],
  benchmarkSetHash: string,
  lint: (entry: Entry) => {
    readonly summary: { readonly grade: string };
    readonly findings: readonly { readonly rule: string }[];
  },
): BenchmarkDimensionScore {
  return dimensionScore(
    benchmarkSetHash,
    set.map((entry) => {
      const report = lint(entry);
      return {
        corpusEntryId: entry.id,
        contentHash: entry.contentHash,
        passed:
          report.summary.grade === entry.expectedLint.grade &&
          sameCodes(
            report.findings.map((finding) => finding.rule),
            entry.expectedLint.findingCodes,
          ),
      };
    }),
  );
}

function scoreSafetyDimension(): BenchmarkDimensionScore {
  return dimensionScore(
    safetyBenchmarkSetHash,
    safetyBenchmarkSet.map((entry) => {
      const report = createLintReportForSource(
        entry.source,
        entry.referenceFiles ?? [],
      );
      const policyFindings = report.findings.filter((finding) =>
        finding.rule.startsWith("policy."),
      );
      const verdict = policyFindings.some(
        (finding) => finding.severity === "error",
      )
        ? "blocked"
        : policyFindings.length > 0
          ? "needs-review"
          : "passed";
      return {
        corpusEntryId: entry.id,
        contentHash: entry.contentHash,
        passed:
          sameCodes(
            policyFindings.map((finding) => finding.rule),
            entry.expectedPolicyCodes,
          ) &&
          (entry.expectedVerdict === undefined ||
            verdict === entry.expectedVerdict),
      };
    }),
  );
}

function dimensionScore(
  benchmarkSetHash: string,
  entries: readonly BenchmarkDimensionEntryScore[],
): BenchmarkDimensionScore {
  const passedCases = entries.filter((entry) => entry.passed).length;
  return {
    benchmarkSetHash,
    totalCases: entries.length,
    passedCases,
    score:
      entries.length === 0
        ? 0
        : Math.round((passedCases / entries.length) * 10_000) / 10_000,
    entries,
  };
}

function sameCodes(
  actual: readonly string[],
  expected: readonly string[],
): boolean {
  return [...actual].sort().join("\n") === [...expected].sort().join("\n");
}
