import type { Prisma, PrismaClient } from "@prisma/client";
import type {
  Scenario,
  TestRun,
  TestRunRepository,
  TestRunStatus,
  TranscriptStep,
} from "@/modules/test-run";
import { analysisReadLimit, toTestRunAnalysisRecord } from "@/modules/test-run";
import type { SkillVersionLintSummary } from "@/modules/skill";
import {
  domainError,
  err,
  HarnessVersionId,
  ok,
  SkillId,
  SkillVersionId,
  TestRunId,
  UserId,
} from "@/shared";

type TestRunRow = {
  id: string;
  skillId: string;
  skillVersionId: string | null;
  harnessVersionId: string | null;
  userId: string;
  status: string;
  scenarioJson: unknown;
  transcriptJson: unknown;
  createdAt: Date;
};

function toTestRun(row: TestRunRow): TestRun {
  return {
    id: TestRunId(row.id),
    skillId: SkillId(row.skillId),
    skillVersionId: row.skillVersionId ? SkillVersionId(row.skillVersionId) : null,
    harnessVersionId: row.harnessVersionId ? HarnessVersionId(row.harnessVersionId) : null,
    userId: UserId(row.userId),
    status: row.status as TestRunStatus,
    scenario: row.scenarioJson as Scenario,
    transcript: row.transcriptJson as readonly TranscriptStep[],
    createdAt: row.createdAt,
  };
}

/** Prisma TestRunRepository (real). Persists generated scenarios and transcripts. */
export function createPrismaTestRunRepository(prisma: PrismaClient): TestRunRepository {
  return {
    async record(run) {
      try {
        const row = await prisma.testRun.create({
          data: {
            skillId: run.skillId,
            skillVersionId: run.skillVersionId,
            harnessVersionId: run.harnessVersionId,
            userId: run.userId,
            status: run.status,
            scenarioJson: run.scenario as unknown as Prisma.InputJsonValue,
            transcriptJson: run.transcript as unknown as Prisma.InputJsonValue,
          },
        });
        return ok(toTestRun(row as TestRunRow));
      } catch (cause) {
        return err(domainError("persistence_failed", "A test run could not be recorded.", cause));
      }
    },

    async findById(id, userId) {
      try {
        const row = await prisma.testRun.findFirst({ where: { id, userId } });
        return ok(row ? toTestRun(row as TestRunRow) : null);
      } catch (cause) {
        return err(domainError("persistence_failed", "A test run could not be loaded.", cause));
      }
    },

    async listBySkill(skillId, userId) {
      try {
        const rows = await prisma.testRun.findMany({
          where: { skillId, userId },
          orderBy: { createdAt: "desc" },
        });
        return ok(rows.map((row) => toTestRun(row as TestRunRow)));
      } catch (cause) {
        return err(domainError("persistence_failed", "Test runs could not be listed.", cause));
      }
    },

    async listByUser(userId) {
      try {
        const rows = await prisma.testRun.findMany({
          where: { userId },
          orderBy: { createdAt: "desc" },
        });
        return ok(rows.map((row) => toTestRun(row as TestRunRow)));
      } catch (cause) {
        return err(domainError("persistence_failed", "Test runs could not be listed.", cause));
      }
    },

    async listForAnalysis(filter = {}) {
      try {
        const rows = await prisma.testRun.findMany({
          where: filter.since ? { createdAt: { gte: filter.since } } : undefined,
          orderBy: { createdAt: "desc" },
          take: analysisReadLimit(filter.limit),
          include: { skillVersion: { select: { lintSummaryJson: true } } },
        });
        return ok(
          rows.map((row) =>
            toTestRunAnalysisRecord(
              toTestRun(row as TestRunRow),
              ((row as { skillVersion?: { lintSummaryJson: unknown } | null }).skillVersion
                ?.lintSummaryJson ?? null) as SkillVersionLintSummary | null,
            ),
          ),
        );
      } catch (cause) {
        return err(
          domainError("persistence_failed", "Test runs could not be read for analysis.", cause),
        );
      }
    },
  };
}
