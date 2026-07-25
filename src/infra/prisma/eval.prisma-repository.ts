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
  type StoredCase = Partial<
    Pick<CaseResult, "caseId" | "attempts" | "passedAttempts" | "passRate">
  > & {
    readonly grader?: CaseResult["grader"];
    readonly prompt: string;
    readonly expected?: "fire" | "silent";
    readonly actual?: "fire" | "silent";
    readonly pass: boolean;
    readonly rationale?: string;
    readonly risk?: "trigger-hijack";
    readonly observed?: CaseResult["observed"];
    readonly graderVersion?: 1;
    readonly expectedSchema?: Readonly<Record<string, unknown>>;
  };
  const legacy = value as Omit<
    TriggeringResult,
    "cases" | "attempts" | "totalAttempts" | "passedAttempts"
  > & Partial<Pick<TriggeringResult, "attempts" | "totalAttempts" | "passedAttempts">> & {
    readonly cases: readonly StoredCase[];
  };
  const cases = legacy.cases.map((item): CaseResult => {
    const attempts = item.attempts ?? 1;
    const passedAttempts = item.passedAttempts ?? (item.pass ? attempts : 0);
    const common = {
      caseId: item.caseId,
      attempts,
      passedAttempts,
      passRate: item.passRate ?? passedAttempts / attempts,
      pass: item.pass,
    };
    if (item.grader === "json-output") {
      const promptCase = {
        grader: "json-output" as const,
        graderVersion: item.graderVersion ?? 1,
        prompt: item.prompt,
        expectedSchema: item.expectedSchema ?? {},
      };
      return {
        ...promptCase,
        ...common,
        caseId: common.caseId ?? triggeringCaseId(promptCase),
        observed: item.observed?.grader === "json-output"
          ? item.observed
          : { grader: "json-output", output: null, validationIssues: [] },
      };
    }
    const promptCase = {
      grader: "selection" as const,
      prompt: item.prompt,
      expected: item.expected ?? "silent",
      ...(item.risk === undefined ? {} : { risk: item.risk }),
    };
    return {
      ...promptCase,
      ...common,
      caseId: common.caseId ?? triggeringCaseId(promptCase),
      observed: item.observed?.grader === "selection"
        ? item.observed
        : {
            grader: "selection",
            actual: item.actual ?? "silent",
            rationale: item.rationale ?? "",
          },
    };
  });
  return {
    ...legacy,
    cases,
    attempts: legacy.attempts ?? cases[0]?.attempts ?? 1,
    totalAttempts: legacy.totalAttempts ?? cases.reduce((sum, item) => sum + item.attempts, 0),
    passedAttempts:
      legacy.passedAttempts ?? cases.reduce((sum, item) => sum + item.passedAttempts, 0),
  };
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
