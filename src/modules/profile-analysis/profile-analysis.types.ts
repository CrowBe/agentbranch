import type { AgentConfigurationSnapshot, SourceSpan } from "@/modules/agent-configuration";
import type { EffectiveConfigurationGraph } from "@/modules/effective-configuration";
import type { Artifact } from "@/modules/skill-analysis";

export type ProfileFindingCode =
  | "contradictory-instruction" | "duplicated-instruction" | "excessive-context"
  | "overlapping-skill-trigger" | "unreachable-component" | "missing-reference"
  | "unsafe-capability-combination" | "hidden-provider-assumption" | "token-cost-hotspot";
export type ProfileFindingSeverity = "error" | "warn" | "info";
export type ProfileEvidence = { readonly path: string; readonly span: SourceSpan; readonly excerpt: string };
export type ProfileFinding = {
  readonly id: string; readonly code: ProfileFindingCode; readonly severity: ProfileFindingSeverity;
  readonly rationale: string; readonly affectedEffectiveBehavior: string; readonly fix: string;
  readonly evidence: readonly ProfileEvidence[]; readonly suppressed: boolean; readonly suppressionRationale?: ProfileEvidence;
};
export type ProfileSuppression = { readonly findingId: string; readonly rationale: ProfileEvidence };
export type ProfileAnalysisInput = { readonly snapshot: AgentConfigurationSnapshot; readonly graph: EffectiveConfigurationGraph; readonly suppressions?: readonly ProfileSuppression[] };
export type ProfileAnalysis = Artifact<"profile-analysis"> & {
  readonly score: number; readonly findings: readonly ProfileFinding[];
  /** Deliberately separate from deterministic findings; this pure capability never populates it. */
  readonly modelAssistedJudgments: readonly never[];
};
export type ProfileInsights = { readonly score: number; readonly summary: string; readonly findings: readonly string[]; readonly watch: readonly string[] };
export type ProfileBreakdown = { readonly score: number; readonly findings: readonly ProfileFinding[] };
