import type { Skill, SkillVersionLintSummary } from "@/modules/skill";
import type { Artifact, Insight } from "@/modules/skill-analysis";
import type { EvalRunId, HarnessVersionId, SkillBranchId, SkillId, SkillVersionId, UserId } from "@/shared";

/** A skill the user's skill competes against for selection (ARCHITECTURE §4). */
export type Distractor = {
  readonly name: string;
  readonly description: string;
};

/** One prompt in the battery, with the outcome we expect. */
export type PromptCase = {
  readonly prompt: string;
  readonly expected: "fire" | "silent";
  /** Flags fixed moderation probes without changing the existing case scoring shape. */
  readonly risk?: "trigger-hijack";
};

/** Result of a single case after running selection. */
export type CaseResult = PromptCase & {
  /** Stable identity of the versioned graded case definition. */
  readonly caseId: string;
  readonly actual: "fire" | "silent";
  readonly pass: boolean;
  readonly attempts: number;
  readonly passedAttempts: number;
  readonly passRate: number;
  /** The model's stated reason for this selection (from `classify`). */
  readonly rationale: string;
};

export type EvalStatus = "queued" | "running" | "passed" | "failed";

export type EvaluationComparisonMetadata = {
  readonly evaluationSetHash: string;
  readonly grader: "selection";
  readonly graderVersion: 1;
  readonly method: "competitive-selection";
  readonly methodVersion: 1;
};

/**
 * The triggering eval's **evaluation result** — the run-record Artifact on the
 * seam (CONTEXT.md → Evaluation result). Ephemeral; renders to Insights (step
 * d). Distinct from the persisted `EvalRun` record below (split is step e).
 */
export type TriggeringResult = Artifact<"triggering-eval"> & {
  readonly cases: readonly CaseResult[];
  readonly passed: boolean;
  readonly attempts: number;
  readonly totalAttempts: number;
  readonly passedAttempts: number;
  /** Absent only on legacy persisted runs, which are incomparable by design. */
  readonly comparisonMetadata?: EvaluationComparisonMetadata;
  /** The model-written interpretation (CONTEXT.md → Insight); renders to Insights. */
  readonly insight: Insight;
};

export type EvalRun = {
  readonly id: EvalRunId;
  readonly userId: UserId;
  readonly skillId: Skill["id"];
  readonly skillVersionId: SkillVersionId | null;
  readonly harnessVersionId: HarnessVersionId | null;
  readonly status: EvalStatus;
  readonly result: TriggeringResult;
  readonly createdAt: Date;
};

export type ComparableEvalRun = EvalRun & {
  /** Resolved from the persisted skill version, never request-time state. */
  readonly branchId: SkillBranchId | null;
};

// --- Admin aggregate read (harness improvement loop, ARCHITECTURE §9) -------

/** Bounds an aggregate read; both fields optional (adapters cap `limit`). */
export type AnalysisReadFilter = {
  readonly since?: Date;
  readonly limit?: number;
};

/** A case outcome with the prompt text stripped: expectation, result, and the
 * classifier's rationale — the features the loop mines, not the content. */
export type EvalCaseOutcome = {
  readonly caseId: string;
  readonly expected: "fire" | "silent";
  readonly actual: "fire" | "silent";
  readonly pass: boolean;
  readonly attempts: number;
  readonly passedAttempts: number;
  readonly passRate: number;
  readonly rationale: string;
  readonly risk?: "trigger-hijack";
};

/**
 * The cross-user read model for the harness improvement loop. Outcomes and
 * features only, by design: no user identity, no prompt text, no skill content
 * — the joined lint summary carries the static skill features (score, counts,
 * fired rules) that Tier-1 correlation needs (ARCHITECTURE §9).
 */
export type EvalRunAnalysisRecord = {
  readonly id: EvalRunId;
  readonly skillId: SkillId;
  readonly skillVersionId: SkillVersionId | null;
  readonly harnessVersionId: HarnessVersionId | null;
  readonly status: EvalStatus;
  readonly passed: boolean;
  readonly attempts: number;
  readonly totalAttempts: number;
  readonly passedAttempts: number;
  readonly cases: readonly EvalCaseOutcome[];
  readonly skillLintSummary: SkillVersionLintSummary | null;
  readonly createdAt: Date;
};
