import type { Skill } from "@/modules/skill";
import type { TestRunId, UserId } from "@/shared";

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

export type TestRunStatus = "queued" | "running" | "completed" | "failed";

export type TestRun = {
  readonly id: TestRunId;
  readonly userId: UserId;
  readonly skillId: Skill["id"];
  readonly status: TestRunStatus;
  readonly scenario: Scenario;
  readonly transcript: readonly TranscriptStep[];
  readonly createdAt: Date;
};
