import type { Prisma, PrismaClient } from "@prisma/client";
import type {
  EvalRun,
  EvalRunRepository,
  EvalStatus,
  CaseResult,
  TriggeringResult,
} from "@/modules/triggering-eval";
import {
  analysisReadLimit,
  toEvalRunAnalysisRecord,
  triggeringCaseId,
  triggeringEvaluationSetHash,
  validateTriggeringAttempts,
} from "@/modules/triggering-eval";
import type { SkillVersionLintSummary } from "@/modules/skill";
import {
  domainError,
  err,
  EvalRunId,
  HarnessVersionId,
  ok,
  SkillId,
  SkillBranchId,
  SkillVersionId,
  UserId,
} from "@/shared";

type EvalRunRow = {
  id: string;
  skillId: string;
  skillVersionId: string | null;
  harnessVersionId: string | null;
  userId: string;
  status: string;
  resultJson: unknown;
  createdAt: Date;
};

function toEvalRun(row: EvalRunRow): EvalRun {
  return {
    id: EvalRunId(row.id),
    skillId: SkillId(row.skillId),
    skillVersionId: row.skillVersionId ? SkillVersionId(row.skillVersionId) : null,
    harnessVersionId: row.harnessVersionId ? HarnessVersionId(row.harnessVersionId) : null,
    userId: UserId(row.userId),
    status: row.status as EvalStatus,
    result: normalizeTriggeringResult(row.resultJson),
    createdAt: row.createdAt,
  };
}

/**
 * Persisted v1 cases predate grader discriminants and observed-outcome
 * wrappers. Normalize them at the repository boundary so all domain consumers
 * see the closed current union.
 */
export function normalizeTriggeringResult(value: unknown): TriggeringResult {
  if (!isRecord(value) || !Array.isArray(value.cases)) {
    throw new TypeError("Persisted triggering result is malformed.");
  }
  const hasCurrentCase = value.cases.some(
    (item) => isRecord(item) && item.grader !== undefined,
  );
  const hasCurrentRoot =
    value.attempts !== undefined ||
    value.totalAttempts !== undefined ||
    value.passedAttempts !== undefined;
  if (hasCurrentCase || (value.cases.length === 0 && hasCurrentRoot)) {
    return normalizeCurrentResult(value);
  }

  const cases = value.cases.map((item) => {
    if (!isRecord(item) || item.grader !== undefined) {
      throw new TypeError("Persisted legacy triggering case is malformed.");
    }
    return normalizeLegacySelection(item);
  });
  if (
    value.kind !== "triggering-eval" ||
    typeof value.passed !== "boolean" ||
    !isInsight(value.insight) ||
    value.passed !== cases.every((item) => item.pass)
  ) {
    throw new TypeError("Persisted legacy triggering result has an invalid root.");
  }
  const attempts = value.attempts === undefined
    ? cases[0]?.attempts ?? 1
    : requireValidAttempts(value.attempts, "attempts");
  if (value.attempts !== undefined && cases.some((item) => item.attempts !== attempts)) {
    throw new TypeError("Persisted legacy case attempt counts do not match the run.");
  }
  const exactTotal = cases.reduce((sum, item) => sum + item.attempts, 0);
  const exactPassed = cases.reduce((sum, item) => sum + item.passedAttempts, 0);
  const totalAttempts = value.totalAttempts === undefined
    ? exactTotal
    : requireNonnegativeInteger(value.totalAttempts, "totalAttempts");
  const passedAttempts = value.passedAttempts === undefined
    ? exactPassed
    : requireNonnegativeInteger(value.passedAttempts, "passedAttempts");
  if (
    totalAttempts !== exactTotal ||
    passedAttempts !== exactPassed ||
    passedAttempts > totalAttempts
  ) {
    throw new TypeError("Persisted legacy triggering result aggregates are inconsistent.");
  }
  return {
    kind: "triggering-eval",
    passed: value.passed,
    cases,
    attempts,
    totalAttempts,
    passedAttempts,
    ...normalizeComparisonMetadata(
      value.comparisonMetadata,
      cases,
      cases.every((item) => item.grader === "selection"),
    ),
    insight: {
      verdict: value.insight.verdict,
      summary: value.insight.summary,
      findings: value.insight.findings,
      watch: value.insight.watch,
    },
  };
}

function normalizeCurrentResult(value: Readonly<Record<string, unknown>>): TriggeringResult {
  if (
    value.kind !== "triggering-eval" ||
    typeof value.passed !== "boolean" ||
    !Array.isArray(value.cases) ||
    !isInsight(value.insight)
  ) {
    throw new TypeError("Persisted current triggering result has an invalid root.");
  }
  const attemptResult = validateTriggeringAttempts(
    requireNumber(value.attempts, "attempts"),
  );
  if (!attemptResult.ok) throw new TypeError(attemptResult.error.message);
  const cases = value.cases.map(normalizeCurrentCase);
  if (cases.some((item) => item.attempts !== attemptResult.value)) {
    throw new TypeError("Persisted case attempt counts do not match the run.");
  }
  const totalAttempts = requireNonnegativeInteger(value.totalAttempts, "totalAttempts");
  const passedAttempts = requireNonnegativeInteger(value.passedAttempts, "passedAttempts");
  const exactTotal = cases.reduce((sum, item) => sum + item.attempts, 0);
  const exactPassed = cases.reduce((sum, item) => sum + item.passedAttempts, 0);
  if (
    passedAttempts > totalAttempts ||
    totalAttempts !== exactTotal ||
    passedAttempts !== exactPassed ||
    value.passed !== cases.every((item) => item.pass)
  ) {
    throw new TypeError("Persisted triggering result aggregates are inconsistent.");
  }
  return {
    kind: "triggering-eval",
    passed: value.passed,
    attempts: attemptResult.value,
    totalAttempts,
    passedAttempts,
    cases,
    ...normalizeComparisonMetadata(
      value.comparisonMetadata,
      cases,
      cases.every((item) => item.grader === "selection"),
    ),
    insight: {
      verdict: value.insight.verdict,
      summary: value.insight.summary,
      findings: value.insight.findings,
      watch: value.insight.watch,
    },
  };
}

function normalizeComparisonMetadata(
  value: unknown,
  cases: readonly CaseResult[],
  allSelection: boolean,
): Pick<TriggeringResult, "comparisonMetadata"> | Record<string, never> {
  if (value === undefined) return {};
  if (!allSelection) {
    throw new TypeError("JSON-output results cannot carry selection comparison metadata.");
  }
  if (
    !isRecord(value) ||
    typeof value.evaluationSetHash !== "string" ||
    value.evaluationSetHash.length === 0 ||
    value.grader !== "selection" ||
    value.graderVersion !== 1 ||
    value.method !== "competitive-selection" ||
    value.methodVersion !== 1
  ) {
    throw new TypeError("Persisted triggering comparison metadata is malformed.");
  }
  if (value.evaluationSetHash !== triggeringEvaluationSetHash(cases)) {
    throw new TypeError("Persisted triggering comparison metadata has the wrong evaluation set.");
  }
  return {
    comparisonMetadata: {
      evaluationSetHash: value.evaluationSetHash,
      grader: "selection",
      graderVersion: 1,
      method: "competitive-selection",
      methodVersion: 1,
    },
  };
}

function normalizeCurrentCase(value: unknown): CaseResult {
  if (!isRecord(value)) throw new TypeError("Persisted triggering case is malformed.");
  if (value.grader === "selection") {
    if (
      typeof value.prompt !== "string" ||
      (value.expected !== "fire" && value.expected !== "silent") ||
      (value.risk !== undefined && value.risk !== "trigger-hijack") ||
      !isRecord(value.observed) ||
      value.observed.grader !== "selection" ||
      (value.observed.actual !== "fire" && value.observed.actual !== "silent") ||
      typeof value.observed.rationale !== "string"
    ) {
      throw new TypeError("Persisted selection case is malformed.");
    }
    const expected: "fire" | "silent" = value.expected;
    const promptCase = {
      grader: "selection" as const,
      prompt: value.prompt,
      expected,
      ...(value.risk === "trigger-hijack" ? { risk: "trigger-hijack" as const } : {}),
    };
    const metrics = currentCaseMetrics(value, promptCase);
    if ((value.observed.actual === expected) !== metrics.pass) {
      throw new TypeError("Persisted selection outcome disagrees with its majority.");
    }
    return {
      ...promptCase,
      ...metrics,
      observed: {
        grader: "selection",
        actual: value.observed.actual,
        rationale: value.observed.rationale,
      },
    };
  }
  if (value.grader === "json-output") {
    if (
      value.graderVersion !== 1 ||
      typeof value.prompt !== "string" ||
      !isRecord(value.expectedSchema) ||
      !isRecord(value.observed) ||
      value.observed.grader !== "json-output" ||
      !Object.hasOwn(value.observed, "output") ||
      !Array.isArray(value.observed.validationIssues) ||
      !value.observed.validationIssues.every((issue) => typeof issue === "string")
    ) {
      throw new TypeError("Persisted JSON-output case is malformed.");
    }
    const promptCase = {
      grader: "json-output" as const,
      graderVersion: 1 as const,
      prompt: value.prompt,
      expectedSchema: value.expectedSchema,
    };
    const metrics = currentCaseMetrics(value, promptCase);
    if ((value.observed.validationIssues.length === 0) !== metrics.pass) {
      throw new TypeError("Persisted JSON-output outcome disagrees with its majority.");
    }
    return {
      ...promptCase,
      ...metrics,
      observed: {
        grader: "json-output",
        output: value.observed.output,
        validationIssues: value.observed.validationIssues,
      },
    };
  }
  throw new TypeError(`Unknown persisted triggering grader: ${String(value.grader)}.`);
}

function normalizeLegacySelection(value: Readonly<Record<string, unknown>>): CaseResult {
  if (
    typeof value.prompt !== "string" ||
    (value.expected !== "fire" && value.expected !== "silent") ||
    (value.actual !== "fire" && value.actual !== "silent") ||
    (value.risk !== undefined && value.risk !== "trigger-hijack") ||
    typeof value.pass !== "boolean" ||
    typeof value.rationale !== "string" ||
    value.pass !== (value.actual === value.expected)
  ) {
    throw new TypeError("Persisted legacy selection case is malformed.");
  }
  const attempts = value.attempts === undefined
    ? 1
    : requireValidAttempts(value.attempts, "case attempts");
  const passedAttempts = value.passedAttempts === undefined
    ? value.pass ? attempts : 0
    : requireNonnegativeInteger(value.passedAttempts, "case passedAttempts");
  const expected: "fire" | "silent" = value.expected;
  const risk: "trigger-hijack" | undefined =
    value.risk === "trigger-hijack" ? "trigger-hijack" : undefined;
  const promptCase = {
    grader: "selection" as const,
    prompt: value.prompt,
    expected,
    ...(risk === undefined ? {} : { risk }),
  };
  return {
    ...promptCase,
    caseId: triggeringCaseId(promptCase),
    observed: { grader: "selection", actual: value.actual, rationale: value.rationale },
    pass: value.pass,
    attempts,
    passedAttempts,
    passRate: validateLegacyCaseMetrics(value, attempts, passedAttempts),
  };
}

function validateLegacyCaseMetrics(
  value: Readonly<Record<string, unknown>>,
  attempts: number,
  passedAttempts: number,
): number {
  const passRate = value.passRate === undefined
    ? passedAttempts / attempts
    : requireNumber(value.passRate, "case passRate");
  if (
    passedAttempts > attempts ||
    passRate !== passedAttempts / attempts ||
    value.pass !== (passedAttempts * 2 > attempts)
  ) {
    throw new TypeError("Persisted legacy triggering case metrics are inconsistent.");
  }
  return passRate;
}

function currentCaseMetrics(
  value: Readonly<Record<string, unknown>>,
  promptCase: Parameters<typeof triggeringCaseId>[0],
): Pick<CaseResult, "caseId" | "pass" | "attempts" | "passedAttempts" | "passRate"> {
  const expectedCaseId = triggeringCaseId(promptCase);
  if (typeof value.caseId !== "string" || value.caseId.length === 0 || value.caseId !== expectedCaseId) {
    throw new TypeError("Persisted current triggering case has an invalid identity.");
  }
  const attemptResult = validateTriggeringAttempts(requireNumber(value.attempts, "case attempts"));
  if (!attemptResult.ok) throw new TypeError(attemptResult.error.message);
  const passedAttempts = requireNonnegativeInteger(value.passedAttempts, "case passedAttempts");
  const passRate = requireNumber(value.passRate, "case passRate");
  const pass = passedAttempts * 2 > attemptResult.value;
  if (
    typeof value.pass !== "boolean" ||
    passedAttempts > attemptResult.value ||
    passRate !== passedAttempts / attemptResult.value ||
    value.pass !== pass
  ) {
    throw new TypeError("Persisted current triggering case metrics are inconsistent.");
  }
  return {
    caseId: value.caseId,
    pass,
    attempts: attemptResult.value,
    passedAttempts,
    passRate,
  };
}

function requireNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`Persisted triggering result has invalid ${field}.`);
  }
  return value;
}

function requireNonnegativeInteger(value: unknown, field: string): number {
  const number = requireNumber(value, field);
  if (!Number.isInteger(number) || number < 0) {
    throw new TypeError(`Persisted triggering result has invalid ${field}.`);
  }
  return number;
}

function requireValidAttempts(value: unknown, field: string): number {
  const number = requireNumber(value, field);
  const result = validateTriggeringAttempts(number);
  if (!result.ok) throw new TypeError(`Persisted triggering result has invalid ${field}.`);
  return result.value;
}

function isInsight(value: unknown): value is TriggeringResult["insight"] {
  return (
    isRecord(value) &&
    (value.verdict === "good" ||
      value.verdict === "needs-attention" ||
      value.verdict === "failing") &&
    typeof value.summary === "string" &&
    Array.isArray(value.findings) &&
    value.findings.every((item) => typeof item === "string") &&
    Array.isArray(value.watch) &&
    value.watch.every((item) => typeof item === "string")
  );
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Prisma EvalRunRepository (real). Persists triggering-eval artifacts. */
export function createPrismaEvalRunRepository(prisma: PrismaClient): EvalRunRepository {
  return {
    async record(run) {
      try {
        const row = await prisma.evalRun.create({
          data: {
            skillId: run.skillId,
            skillVersionId: run.skillVersionId,
            harnessVersionId: run.harnessVersionId,
            userId: run.userId,
            status: run.status,
            resultJson: run.result as unknown as Prisma.InputJsonValue,
          },
        });
        return ok(toEvalRun(row as EvalRunRow));
      } catch (cause) {
        return err(domainError("persistence_failed", "An eval run could not be recorded.", cause));
      }
    },

    async findById(id, userId) {
      try {
        const row = await prisma.evalRun.findFirst({ where: { id, userId } });
        return ok(row ? toEvalRun(row as EvalRunRow) : null);
      } catch (cause) {
        return err(domainError("persistence_failed", "An eval run could not be loaded.", cause));
      }
    },

    async findComparableById(id, userId) {
      try {
        const row = await prisma.evalRun.findFirst({
          where: { id, userId },
          include: { skillVersion: { select: { branchId: true } } },
        });
        if (!row) return ok(null);
        const run = toEvalRun(row as EvalRunRow);
        const branchId = (row as { skillVersion?: { branchId: string } | null }).skillVersion?.branchId;
        return ok({ ...run, branchId: branchId ? SkillBranchId(branchId) : null });
      } catch (cause) {
        return err(domainError("persistence_failed", "An eval run could not be loaded for comparison.", cause));
      }
    },

    async listBySkill(skillId, userId) {
      try {
        const rows = await prisma.evalRun.findMany({
          where: { skillId, userId },
          orderBy: { createdAt: "desc" },
        });
        return ok(rows.map((row) => toEvalRun(row as EvalRunRow)));
      } catch (cause) {
        return err(domainError("persistence_failed", "Eval runs could not be listed.", cause));
      }
    },

    async listByUser(userId) {
      try {
        const rows = await prisma.evalRun.findMany({
          where: { userId },
          orderBy: { createdAt: "desc" },
        });
        return ok(rows.map((row) => toEvalRun(row as EvalRunRow)));
      } catch (cause) {
        return err(domainError("persistence_failed", "Eval runs could not be listed.", cause));
      }
    },

    async listForAnalysis(filter = {}) {
      try {
        const rows = await prisma.evalRun.findMany({
          where: filter.since ? { createdAt: { gte: filter.since } } : undefined,
          orderBy: { createdAt: "desc" },
          take: analysisReadLimit(filter.limit),
          include: { skillVersion: { select: { lintSummaryJson: true } } },
        });
        return ok(
          rows.map((row) =>
            toEvalRunAnalysisRecord(
              toEvalRun(row as EvalRunRow),
              ((row as { skillVersion?: { lintSummaryJson: unknown } | null }).skillVersion
                ?.lintSummaryJson ?? null) as SkillVersionLintSummary | null,
            ),
          ),
        );
      } catch (cause) {
        return err(
          domainError("persistence_failed", "Eval runs could not be read for analysis.", cause),
        );
      }
    },
  };
}
