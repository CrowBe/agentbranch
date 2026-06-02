import type { Skill } from "@/modules/skill";
import type { EvalRunId, UserId } from "@/shared";

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
};

export type EvalStatus = "queued" | "running" | "passed" | "failed";

export type TriggeringResult = {
  readonly cases: readonly CaseResult[];
  readonly passed: boolean;
};

export type EvalRun = {
  readonly id: EvalRunId;
  readonly userId: UserId;
  readonly skillId: Skill["id"];
  readonly status: EvalStatus;
  readonly result: TriggeringResult;
  readonly createdAt: Date;
};
