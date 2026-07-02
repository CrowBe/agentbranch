import type { Skill } from "@/modules/skill";
import type { Artifact, Insight } from "@/modules/skill-analysis";
import type { HarnessVersionId, SkillVersionId, TestRunId, UserId } from "@/shared";

/**
 * A mock tool the skill can "call" during a test run. The registry returns
 * generated data instead of touching anything real (ARCHITECTURE §2). Skills
 * are instruction-only, so there is no code to execute or container to isolate.
 */
export type MockTool = {
  readonly name: string;
  readonly description: string;
  /** Generate mock output for a call, deterministic within a session. */
  respond(input: Readonly<Record<string, unknown>>): unknown;
};

/** The mechanism behind a test run: name → mock tool. */
export interface MockToolRegistry {
  list(): readonly MockTool[];
  get(name: string): MockTool | undefined;
  register(tool: MockTool): void;
}

/** The generated situation a skill is run against (1 per run in v1). */
export type Scenario = {
  readonly prompt: string;
  readonly seedData: Readonly<Record<string, unknown>>;
};

export type TranscriptStep =
  | { readonly kind: "model"; readonly text: string }
  | { readonly kind: "tool-call"; readonly tool: string; readonly input: unknown }
  | { readonly kind: "tool-result"; readonly tool: string; readonly output: unknown };

/**
 * The test run's **evaluation result** — the run-record Artifact on the seam
 * (CONTEXT.md → Evaluation result). The transcript of what the skill did against
 * the mock-tool registry. Ephemeral; renders to Insights (step d). Distinct from
 * the persisted `TestRun` record below (split is step e).
 */
export type TestRunResult = Artifact<"test-run"> & {
  readonly scenario: Scenario;
  readonly transcript: readonly TranscriptStep[];
  /** The model-written interpretation (CONTEXT.md → Insight); renders to Insights. */
  readonly insight: Insight;
};

export type TestRunStatus = "queued" | "running" | "completed" | "failed";

export type TestRun = {
  readonly id: TestRunId;
  readonly userId: UserId;
  readonly skillId: Skill["id"];
  readonly skillVersionId: SkillVersionId | null;
  readonly harnessVersionId: HarnessVersionId | null;
  readonly status: TestRunStatus;
  readonly scenario: Scenario;
  readonly transcript: readonly TranscriptStep[];
  readonly createdAt: Date;
};
