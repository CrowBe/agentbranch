import type { Skill } from "@/modules/skill";
import type { Artifact, Insight } from "@/modules/skill-analysis";
import type { EvalRunId, SkillVersionId, UserId } from "@/shared";

/** A skill the user's skill competes against for selection (ARCHITECTURE §4). */
export type Distractor = {
  readonly name: string;
  readonly description: string;
};

/** One prompt in the battery, with the outcome we expect. */
export type PromptCase = {
  readonly prompt: string;
  readonly expected: "fire" | "silent";
};

/** Result of a single case after running selection. */
export type CaseResult = PromptCase & {
  readonly actual: "fire" | "silent";
  readonly pass: boolean;
  /** The model's stated reason for this selection (from `classify`). */
  readonly rationale: string;
};

export type EvalStatus = "queued" | "running" | "passed" | "failed";

/**
 * The triggering eval's **evaluation result** — the run-record Artifact on the
 * seam (CONTEXT.md → Evaluation result). Ephemeral; renders to Insights (step
 * d). Distinct from the persisted `EvalRun` record below (split is step e).
 */
export type TriggeringResult = Artifact<"triggering-eval"> & {
  readonly cases: readonly CaseResult[];
  readonly passed: boolean;
  /** The model-written interpretation (CONTEXT.md → Insight); renders to Insights. */
  readonly insight: Insight;
};

export type EvalRun = {
  readonly id: EvalRunId;
  readonly userId: UserId;
  readonly skillId: Skill["id"];
  readonly skillVersionId: SkillVersionId | null;
  readonly status: EvalStatus;
  readonly result: TriggeringResult;
  readonly createdAt: Date;
};
