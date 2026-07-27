import type { Prisma, PrismaClient } from "@prisma/client";
import {
  type AgentConfiguration,
  type AgentConfigurationDraft,
  type AgentConfigurationRepository,
  type AgentConfigurationSnapshot,
  type AgentConfigurationVersion,
} from "@/modules/agent-configuration";
import {
  AgentConfigurationId,
  AgentConfigurationVersionId,
  UserId,
  domainError,
  err,
  ok,
} from "@/shared";

type ConfigurationRow = {
  id: string;
  userId: string;
  name: string;
  mainVersionId: string | null;
  createdAt: Date;
  updatedAt: Date;
  mainVersion: VersionRow | null;
};
type VersionRow = {
  id: string;
  configurationId: string;
  revision: number;
  snapshotJson: unknown;
  createdAt: Date;
};
type DraftRow = {
  configurationId: string;
  baseVersionId: string;
  snapshotJson: unknown;
};

const snapshotJson = (snapshot: AgentConfigurationSnapshot): Prisma.InputJsonValue =>
  snapshot as unknown as Prisma.InputJsonValue;

function toVersion(row: VersionRow): AgentConfigurationVersion {
  return {
    id: AgentConfigurationVersionId(row.id),
    configurationId: AgentConfigurationId(row.configurationId),
    revision: row.revision,
    snapshot: row.snapshotJson as AgentConfigurationSnapshot,
    createdAt: row.createdAt,
  };
}

function toConfiguration(row: ConfigurationRow): AgentConfiguration {
  if (!row.mainVersionId || !row.mainVersion) throw new Error("Agent configuration has no main version.");
  return {
    id: AgentConfigurationId(row.id),
    userId: UserId(row.userId),
    name: row.name,
    mainVersionId: AgentConfigurationVersionId(row.mainVersionId),
    mainVersion: toVersion(row.mainVersion),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const toDraft = (row: DraftRow): AgentConfigurationDraft => ({
  configurationId: AgentConfigurationId(row.configurationId),
  baseVersionId: AgentConfigurationVersionId(row.baseVersionId),
  snapshot: row.snapshotJson as AgentConfigurationSnapshot,
});

const includeMain = { mainVersion: true } as const;

export function createPrismaAgentConfigurationRepository(
  prisma: PrismaClient,
): AgentConfigurationRepository {
  return {
    async create({ userId, name, snapshot }) {
      const row = await prisma.$transaction(async (tx) => {
        const configuration = await tx.agentConfiguration.create({ data: { userId, name } });
        const version = await tx.agentConfigurationVersion.create({
          data: { configurationId: configuration.id, revision: 1, snapshotJson: snapshotJson(snapshot) },
        });
        return tx.agentConfiguration.update({
          where: { id: configuration.id },
          data: { mainVersionId: version.id },
          include: includeMain,
        });
      });
      return ok(toConfiguration(row as ConfigurationRow));
    },
    async findById(id, userId) {
      const row = await prisma.agentConfiguration.findFirst({
        where: { id, userId },
        include: includeMain,
      });
      return ok(row ? toConfiguration(row as ConfigurationRow) : null);
    },
    async listByUser(userId) {
      const rows = await prisma.agentConfiguration.findMany({
        where: { userId },
        include: includeMain,
        orderBy: { updatedAt: "desc" },
      });
      return ok(rows.map((row) => toConfiguration(row as ConfigurationRow)));
    },
    async saveDraft({ id, userId, snapshot }) {
      const configuration = await prisma.agentConfiguration.findFirst({ where: { id, userId } });
      if (!configuration?.mainVersionId) {
        return err(domainError("not_found", `No agent configuration ${id}.`));
      }
      const draft = await prisma.agentConfigurationDraft.upsert({
        where: { configurationId: id },
        create: {
          configurationId: id,
          baseVersionId: configuration.mainVersionId,
          snapshotJson: snapshotJson(snapshot),
        },
        update: {
          baseVersionId: configuration.mainVersionId,
          snapshotJson: snapshotJson(snapshot),
        },
      });
      return ok(toDraft(draft as DraftRow));
    },
    async getDraft(id, userId) {
      const configuration = await prisma.agentConfiguration.findFirst({
        where: { id, userId },
        select: { id: true },
      });
      if (!configuration) return ok(null);
      const draft = await prisma.agentConfigurationDraft.findUnique({ where: { configurationId: id } });
      return ok(draft ? toDraft(draft as DraftRow) : null);
    },
    async promoteDraft({ id, userId }) {
      const row = await prisma.$transaction(async (tx) => {
        const configuration = await tx.agentConfiguration.findFirst({
          where: { id, userId },
          include: { draft: true, mainVersion: true },
        });
        if (!configuration?.mainVersion || !configuration.draft) return null;
        if (configuration.draft.baseVersionId !== configuration.mainVersionId) {
          throw new Error("The draft baseline is no longer main.");
        }
        const version = await tx.agentConfigurationVersion.create({
          data: {
            configurationId: id,
            revision: configuration.mainVersion.revision + 1,
            snapshotJson: configuration.draft.snapshotJson as Prisma.InputJsonValue,
          },
        });
        await tx.agentConfigurationDraft.delete({ where: { configurationId: id } });
        return tx.agentConfiguration.update({
          where: { id },
          data: { mainVersionId: version.id },
          include: includeMain,
        });
      });
      if (!row) return err(domainError("not_found", `No draft for agent configuration ${id}.`));
      return ok(toConfiguration(row as ConfigurationRow));
    },
    async listVersions(id, userId) {
      const owned = await prisma.agentConfiguration.findFirst({
        where: { id, userId },
        select: { id: true },
      });
      if (!owned) return ok([]);
      const rows = await prisma.agentConfigurationVersion.findMany({
        where: { configurationId: id },
        orderBy: { revision: "desc" },
      });
      return ok(rows.map((row) => toVersion(row as VersionRow)));
    },
  };
}
