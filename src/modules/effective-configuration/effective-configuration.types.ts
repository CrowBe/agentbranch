import type {
  AgentComponentKind,
  AgentConfigurationSnapshot,
  SourceSpan,
} from "@/modules/agent-configuration";
import type { Artifact } from "@/modules/skill-analysis";

export type EffectiveConfigurationConfidence = "certain" | "probable" | "ambiguous";

export type EffectiveConfigurationEvidence = {
  readonly path: string;
  readonly span: SourceSpan;
  readonly adapterRule: string;
  readonly confidence: EffectiveConfigurationConfidence;
};

export type EffectiveConfigurationRelationshipKind =
  | "loads"
  | "overrides"
  | "references"
  | "selects"
  | "delegates-to"
  | "permits"
  | "requires"
  | "unknown";

export type EffectiveConfigurationRelationshipStatus =
  | "resolved"
  | "unresolved"
  | "ambiguous";

export type EffectiveConfigurationNode = {
  readonly id: string;
  readonly componentId: string;
  readonly kind: AgentComponentKind;
  readonly label: string;
  readonly effective: boolean;
  readonly order?: number;
  readonly evidence: EffectiveConfigurationEvidence;
};

export type EffectiveConfigurationEdge = {
  readonly id: string;
  readonly kind: EffectiveConfigurationRelationshipKind;
  readonly from: string;
  readonly to?: string;
  readonly target: string;
  readonly status: EffectiveConfigurationRelationshipStatus;
  readonly evidence: EffectiveConfigurationEvidence;
};

export type EffectiveConfigurationFindingCode =
  | "unresolved-reference"
  | "shadowed-instruction"
  | "duplicate-declaration"
  | "unreachable-component"
  | "ambiguous-precedence"
  | "ambiguous-relationship";

export type EffectiveConfigurationFinding = {
  readonly code: EffectiveConfigurationFindingCode;
  readonly message: string;
  readonly nodeIds: readonly string[];
  readonly evidence: EffectiveConfigurationEvidence;
};

export type EffectiveConfigurationRuleRelationship = {
  readonly kind: EffectiveConfigurationRelationshipKind;
  /** Component id, source path, or adapter-declared logical name. */
  readonly target: string;
  readonly confidence: EffectiveConfigurationConfidence;
  readonly span?: SourceSpan;
};

/**
 * Runtime adapters translate their precedence and reference semantics into
 * this runtime-neutral vocabulary. The resolver never knows runtime names.
 */
export type EffectiveConfigurationResolutionRule = {
  readonly componentId: string;
  readonly adapterRule: string;
  readonly label?: string;
  readonly declaration?: string;
  readonly precedence?: number;
  readonly instructionOrder?: number;
  readonly root?: boolean;
  readonly relationships?: readonly EffectiveConfigurationRuleRelationship[];
};

export type EffectiveConfigurationInput = {
  readonly snapshot: AgentConfigurationSnapshot;
  readonly rules: readonly EffectiveConfigurationResolutionRule[];
};

export type EffectiveConfigurationGraph =
  Artifact<"effective-configuration-graph"> & {
    readonly nodes: readonly EffectiveConfigurationNode[];
    readonly edges: readonly EffectiveConfigurationEdge[];
    readonly findings: readonly EffectiveConfigurationFinding[];
    readonly effective: {
      readonly instructions: readonly string[];
      readonly skills: readonly string[];
      readonly tools: readonly string[];
      readonly modelSettings: readonly string[];
      readonly policies: readonly string[];
    };
  };

export type EffectiveConfigurationOutlineRow = {
  readonly nodeId: string;
  readonly component: string;
  readonly kind: AgentComponentKind;
  readonly status: "effective" | "shadowed";
  readonly source: string;
  readonly adapterRule: string;
  readonly confidence: EffectiveConfigurationConfidence;
};

export type EffectiveConfigurationOutline = {
  readonly title: string;
  readonly instructionOrder: readonly {
    readonly nodeId: string;
    readonly position: number;
    readonly label: string;
    readonly source: string;
  }[];
  readonly rows: readonly EffectiveConfigurationOutlineRow[];
  readonly relationships: readonly {
    readonly id: string;
    readonly relationship: EffectiveConfigurationRelationshipKind;
    readonly source: string;
    readonly target: string;
    readonly status: EffectiveConfigurationRelationshipStatus;
  }[];
  readonly findings: readonly {
    readonly code: EffectiveConfigurationFindingCode;
    readonly message: string;
    readonly source: string;
  }[];
};
