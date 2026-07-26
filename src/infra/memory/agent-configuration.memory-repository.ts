import {
  makeAgentConfiguration,
  newAgentConfigurationId,
  newAgentConfigurationVersionId,
  type AgentConfiguration,
  type AgentConfigurationDraft,
  type AgentConfigurationRepository,
  type AgentConfigurationVersion,
} from "@/modules/agent-configuration";
import { domainError, err, ok, type UserId } from "@/shared";

export function createMemoryAgentConfigurationRepository(): AgentConfigurationRepository {
  const configurations = new Map<string, AgentConfiguration>();
  const versions = new Map<string, AgentConfigurationVersion[]>();
  const drafts = new Map<string, AgentConfigurationDraft>();
  const owned = (id: string, userId: UserId) => {
    const configuration = configurations.get(id);
    return configuration?.userId === userId ? configuration : null;
  };

  return {
    async create({ userId, name, snapshot }) {
      const now = new Date();
      const configuration = makeAgentConfiguration({
        id: newAgentConfigurationId(),
        versionId: newAgentConfigurationVersionId(),
        userId,
        name,
        snapshot,
        createdAt: now,
        updatedAt: now,
      });
      configurations.set(configuration.id, configuration);
      versions.set(configuration.id, [configuration.mainVersion]);
      return ok(configuration);
    },
    async findById(id, userId) {
      return ok(owned(id, userId));
    },
    async listByUser(userId) {
      return ok([...configurations.values()].filter((item) => item.userId === userId));
    },
    async saveDraft({ id, userId, snapshot }) {
      const configuration = owned(id, userId);
      if (!configuration) return err(domainError("not_found", `No agent configuration ${id}.`));
      const draft = { configurationId: id, baseVersionId: configuration.mainVersionId, snapshot };
      drafts.set(id, draft);
      return ok(draft);
    },
    async getDraft(id, userId) {
      return ok(owned(id, userId) ? drafts.get(id) ?? null : null);
    },
    async promoteDraft({ id, userId }) {
      const configuration = owned(id, userId);
      const draft = drafts.get(id);
      if (!configuration || !draft) {
        return err(domainError("not_found", `No draft for agent configuration ${id}.`));
      }
      if (draft.baseVersionId !== configuration.mainVersionId) {
        return err(domainError("invalid_operation", "The draft baseline is no longer main."));
      }
      const now = new Date();
      const next = makeAgentConfiguration({
        id: configuration.id,
        versionId: newAgentConfigurationVersionId(),
        userId: configuration.userId,
        name: configuration.name,
        snapshot: draft.snapshot,
        revision: configuration.mainVersion.revision + 1,
        createdAt: configuration.createdAt,
        updatedAt: now,
      });
      configurations.set(id, next);
      versions.set(id, [...(versions.get(id) ?? []), next.mainVersion]);
      drafts.delete(id);
      return ok(next);
    },
    async listVersions(id, userId) {
      return ok(owned(id, userId) ? [...(versions.get(id) ?? [])].reverse() : []);
    },
  };
}
