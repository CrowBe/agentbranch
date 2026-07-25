import { createHash } from "node:crypto";
import type { EvalRunRepository } from "@/modules/triggering-eval";
import type { ComparableEvalRun } from "@/modules/triggering-eval";
import { isErr, ok, type DomainError, type EvalRunId, type Result, type UserId } from "@/shared";
import type {
  EvalComparisonReason,
  EvalRunComparison,
} from "./eval-comparison.types";

const METHOD_VERSION = 1 as const;
const RESAMPLES = 10_000 as const;
const CONFIDENCE = 0.95 as const;

export async function compareEvalRuns(
  repository: EvalRunRepository,
  userId: UserId,
  leftRunId: EvalRunId,
  rightRunId: EvalRunId,
): Promise<Result<EvalRunComparison, DomainError>> {
  if (leftRunId === rightRunId) return ok(incomparable("same-run", leftRunId, rightRunId));
  const [leftResult, rightResult] = await Promise.all([
    repository.findComparableById(leftRunId, userId),
    repository.findComparableById(rightRunId, userId),
  ]);
  if (isErr(leftResult)) return leftResult;
  if (isErr(rightResult)) return rightResult;
  const left = leftResult.value;
  const right = rightResult.value;
  if (!left || !right) {
    return ok(incomparable("run-not-found-or-not-owned", leftRunId, rightRunId));
  }
  const reason = incompatibility(left, right);
  if (reason) return ok(incomparable(reason, leftRunId, rightRunId));

  const leftVersion = left.skillVersionId!;
  const rightVersion = right.skillVersionId!;
  const leftBranch = left.branchId!;
  const rightBranch = right.branchId!;
  const harness = left.harnessVersionId!;
  const metadata = left.result.comparisonMetadata!;
  const cases = left.result.cases.map((leftCase, index) => {
    const rightCase = right.result.cases[index]!;
    return {
      caseId: leftCase.caseId,
      leftRate: leftCase.passRate,
      rightRate: rightCase.passRate,
      delta: rightCase.passRate - leftCase.passRate,
    };
  });
  const seed = comparisonSeed(metadata.evaluationSetHash, leftRunId, rightRunId);
  const aggregate = bootstrap(cases.map((item) => item.delta), seed);
  return ok({
    comparable: true,
    method: "paired-case-cluster-bootstrap",
    methodVersion: METHOD_VERSION,
    confidence: CONFIDENCE,
    seed,
    resamples: RESAMPLES,
    skillId: left.skillId,
    evaluationSetHash: metadata.evaluationSetHash,
    left: {
      runId: leftRunId,
      skillVersionId: leftVersion,
      branchId: leftBranch,
      harnessVersionId: harness,
    },
    right: {
      runId: rightRunId,
      skillVersionId: rightVersion,
      branchId: rightBranch,
      harnessVersionId: right.harnessVersionId!,
    },
    cases,
    aggregate,
    verdict:
      aggregate.lower > 0
        ? "improved"
        : aggregate.upper < 0
          ? "regressed"
          : "not-distinguishable",
  });
}

function incompatibility(
  left: ComparableEvalRun,
  right: ComparableEvalRun,
): EvalComparisonReason | null {
  if (!left.result.comparisonMetadata || !right.result.comparisonMetadata) return "legacy-metadata";
  if (left.skillId !== right.skillId) return "different-skill";
  if (!left.skillVersionId || !right.skillVersionId) return "missing-version";
  if (!left.branchId || !right.branchId) return "missing-branch";
  if (!left.harnessVersionId || !right.harnessVersionId) return "different-harness";
  if (left.harnessVersionId !== right.harnessVersionId) return "different-harness";
  const leftMeta = left.result.comparisonMetadata;
  const rightMeta = right.result.comparisonMetadata;
  if (leftMeta.evaluationSetHash !== rightMeta.evaluationSetHash) return "different-evaluation-set";
  if (left.result.cases.length === 0 || right.result.cases.length === 0) return "empty-case-set";
  if (left.result.cases.map((item) => item.caseId).join("\n") !==
      right.result.cases.map((item) => item.caseId).join("\n")) return "different-case-order";
  if (left.result.attempts !== right.result.attempts ||
      left.result.cases.some((item, index) => item.attempts !== right.result.cases[index]?.attempts)) {
    return "different-attempts";
  }
  if (leftMeta.grader !== rightMeta.grader || leftMeta.graderVersion !== rightMeta.graderVersion) {
    return "different-grader";
  }
  if (leftMeta.method !== rightMeta.method || leftMeta.methodVersion !== rightMeta.methodVersion) {
    return "different-method";
  }
  return null;
}

function incomparable(
  reason: EvalComparisonReason,
  leftRunId: EvalRunId,
  rightRunId: EvalRunId,
): EvalRunComparison {
  return { comparable: false, reason, leftRunId, rightRunId, methodVersion: METHOD_VERSION };
}

function comparisonSeed(setHash: string, left: EvalRunId, right: EvalRunId): number {
  return createHash("sha256")
    .update(JSON.stringify(["eval-comparison-seed", METHOD_VERSION, setHash, left, right]))
    .digest()
    .readUInt32BE(0);
}

function bootstrap(deltas: readonly number[], seed: number) {
  const point = mean(deltas);
  const random = mulberry32(seed);
  const samples = Array.from({ length: RESAMPLES }, () => {
    let sum = 0;
    for (let index = 0; index < deltas.length; index += 1) {
      sum += deltas[Math.floor(random() * deltas.length)]!;
    }
    return sum / deltas.length;
  }).sort((left, right) => left - right);
  return {
    delta: point,
    lower: percentile(samples, 0.025),
    upper: percentile(samples, 0.975),
  };
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(sorted: readonly number[], probability: number): number {
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const weight = position - lower;
  return sorted[lower]! * (1 - weight) + sorted[Math.min(lower + 1, sorted.length - 1)]! * weight;
}

function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}
