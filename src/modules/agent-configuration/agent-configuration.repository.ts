import type { DomainError, Result, AgentConfigurationId, UserId } from "@/shared";
import type {
  AgentConfiguration,
  AgentConfigurationDraft,
  AgentConfigurationSnapshot,
  AgentConfigurationVersion,
} from "./agent-configuration.types";

export interface AgentConfigurationRepository {
  create(input: {
    userId: UserId;
    name: string;
    snapshot: AgentConfigurationSnapshot;
  }): Promise<Result<AgentConfiguration, DomainError>>;
  findById(
    id: AgentConfigurationId,
    userId: UserId,
  ): Promise<Result<AgentConfiguration | null, DomainError>>;
  listByUser(userId: UserId): Promise<Result<readonly AgentConfiguration[], DomainError>>;
  saveDraft(input: {
    id: AgentConfigurationId;
    userId: UserId;
    snapshot: AgentConfigurationSnapshot;
  }): Promise<Result<AgentConfigurationDraft, DomainError>>;
  getDraft(
    id: AgentConfigurationId,
    userId: UserId,
  ): Promise<Result<AgentConfigurationDraft | null, DomainError>>;
  promoteDraft(input: {
    id: AgentConfigurationId;
    userId: UserId;
  }): Promise<Result<AgentConfiguration, DomainError>>;
  listVersions(
    id: AgentConfigurationId,
    userId: UserId,
  ): Promise<Result<readonly AgentConfigurationVersion[], DomainError>>;
}
