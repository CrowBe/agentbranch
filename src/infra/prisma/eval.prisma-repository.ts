import type { Prisma, PrismaClient } from "@prisma/client";
import type {
  EvalRun,
  EvalRunRepository,
  EvalStatus,
  TriggeringResult,
} from "@/modules/triggering-eval";
import { analysisReadLimit, toEvalRunAnalysisRecord } from "@/modules/triggering-eval";
import type { SkillVersionLintSummary } from "@/modules/skill";
import {
  domainError,
  err,
  EvalRunId,
  HarnessVersionId,
  ok,
  SkillId,
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
    result: row.resultJson as TriggeringResult,
    createdAt: row.createdAt,
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
