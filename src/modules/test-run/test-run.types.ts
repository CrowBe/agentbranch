import type { ResponseSchemaSource } from "@/modules/response-schema";
import type { Skill, SkillVersionLintSummary } from "@/modules/skill";
import type { Artifact, Insight } from "@/modules/skill-analysis";
import type { ToolContractSource } from "@/modules/tool-contract";
import type { HarnessVersionId, SkillId, SkillVersionId, TestRunId, UserId } from "@/shared";

/**
 * What a test run evaluates: a Skill alone, or a **bundle** — the Skill plus
 * the Tool contracts it should call and the Response schemas those contracts
 * reference (ARCHITECTURE §9.2, smallest useful composition). The seam's
 * generic `Input` slot carries this; contracts drive the mock-tool registry
 * and the per-call validation below.
 */
export type TestRunInput = {
  readonly skill: Skill;
  readonly toolContracts?: readonly ToolContractSource[];
  readonly responseSchemas?: readonly ResponseSchemaSource[];
};

/** One observed call to a contracted tool, validated against the contract. */
export type ContractCallCheck = {
  /** 1-based ordinal among this tool's calls in the transcript. */
  readonly call: number;
  /** Mismatches between the skill's call arguments and the contract's input schema. */
  readonly argumentIssues: readonly string[];
  /** Mismatches between the returned mock output and the contract's output schema. */
  readonly outputIssues: readonly string[];
};

/**
 * The relational half of a test-run result: for one supplied Tool contract,
 * did the Skill call the tool, and did each call match the contract (and its
 * response schema)? Empty `contractChecks` on the result means the run was a
 * plain single-primitive test run.
 */
export type ContractCheck = {
  readonly tool: string;
  readonly called: boolean;
  readonly calls: readonly ContractCallCheck[];
};

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
  /** Per-contract call validation when the input was a bundle; empty otherwise. */
  readonly contractChecks: readonly ContractCheck[];
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

// --- Admin aggregate read (harness improvement loop, ARCHITECTURE §9) -------

/** Bounds an aggregate read; both fields optional (adapters cap `limit`). */
export type AnalysisReadFilter = {
  readonly since?: Date;
  readonly limit?: number;
};

/** Which tools the skill reached for during the run — names and call counts,
 * never the payloads. */
export type TestRunToolUse = {
  readonly tool: string;
  readonly calls: number;
};

/**
 * The cross-user read model for the harness improvement loop. Outcomes and
 * features only, by design: no user identity, no scenario or transcript
 * content — the transcript is reduced to tool-use shape, and the joined lint
 * summary carries the static skill features (ARCHITECTURE §9).
 */
export type TestRunAnalysisRecord = {
  readonly id: TestRunId;
  readonly skillId: SkillId;
  readonly skillVersionId: SkillVersionId | null;
  readonly harnessVersionId: HarnessVersionId | null;
  readonly status: TestRunStatus;
  readonly toolUse: readonly TestRunToolUse[];
  readonly modelSteps: number;
  readonly skillLintSummary: SkillVersionLintSummary | null;
  readonly createdAt: Date;
};
