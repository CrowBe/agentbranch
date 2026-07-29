import type {
  AgentConfigurationId,
  AgentConfigurationVersionId,
  UserId,
} from "@/shared";

export type AgentComponentKind =
  | "instruction"
  | "skill"
  | "subagent"
  | "tool"
  | "policy"
  | "model"
  | "hook"
  | "reference"
  | "evaluation"
  | "unknown";

export type SourceSpan = {
  readonly startLine: number;
  readonly startColumn: number;
  readonly endLine: number;
  readonly endColumn: number;
};

export type SourceFile = {
  readonly path: string;
  readonly content: string;
  /** `content` is literal UTF-8 text or base64-encoded opaque bytes. */
  readonly encoding: "utf8" | "base64";
  readonly contentHash: string;
};

export type AgentComponent = {
  readonly id: string;
  readonly kind: AgentComponentKind;
  readonly path: string;
  readonly span?: SourceSpan;
  readonly contentHash: string;
};

export type SecretRequirement = {
  readonly name: string;
  readonly purpose: string;
};

export type AgentConfigurationImportProvenance = {
  readonly runtime: string;
  readonly adapter: {
    readonly id: string;
    readonly version: string;
  };
};

export type AgentConfigurationSnapshot = {
  readonly files: readonly SourceFile[];
  readonly components: readonly AgentComponent[];
  readonly secretRequirements: readonly SecretRequirement[];
  /**
   * Detected source layouts and the adapters that interpreted them. This is
   * provenance only: array order does not express runtime precedence.
   */
  readonly importProvenance: readonly AgentConfigurationImportProvenance[];
};

export type AgentConfigurationVersion = {
  readonly id: AgentConfigurationVersionId;
  readonly configurationId: AgentConfigurationId;
  readonly revision: number;
  readonly snapshot: AgentConfigurationSnapshot;
  readonly createdAt: Date;
};

export type AgentConfiguration = {
  readonly id: AgentConfigurationId;
  readonly userId: UserId;
  readonly name: string;
  readonly mainVersionId: AgentConfigurationVersionId;
  readonly mainVersion: AgentConfigurationVersion;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

export type AgentConfigurationDraft = {
  readonly configurationId: AgentConfigurationId;
  readonly baseVersionId: AgentConfigurationVersionId;
  readonly snapshot: AgentConfigurationSnapshot;
};
