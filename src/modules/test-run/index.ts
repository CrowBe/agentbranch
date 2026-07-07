/**
 * test-run — run a skill against mocked tools (ARCHITECTURE §2, §5.4).
 *
 * User-facing term is always "test run", never "sandbox". The mechanism is the
 * mock-tool registry; the agent tool is `execute_skill`. Nothing real is ever
 * touched.
 *
 * An **evaluation capability** on the seam: the evaluator owns its method
 * (builds its own Scenario + mock-tool registry, composes `gateway.runAgent`
 * with the mocks as tool handlers); the model gateway is handed in. Its input
 * is a `TestRunInput` **bundle** — the Skill, optionally with Tool contracts
 * and the Response schemas they reference (ARCHITECTURE §9.2): contracts drive
 * the mock-tool registry and each observed call is validated against them.
 * Its artifact is the `TestRunResult` — rendered to Insights (default) and
 * Breakdown.
 */
import { defineEvaluation } from "@/modules/skill-analysis";
import type { Evaluator, Renderer, Insight } from "@/modules/skill-analysis";
import { contractCheckIssues } from "./contract-checks";
import { executeSkill } from "./execute-skill";
import type {
  ContractCheck,
  Scenario,
  TestRunInput,
  TestRunResult,
  TranscriptStep,
} from "./test-run.types";

/** The detailed-breakdown surface: the scenario, the raw transcript, and the
 * per-contract call validation (empty for a single-primitive run). */
export type TestRunBreakdown = {
  readonly scenario: Scenario;
  readonly transcript: readonly TranscriptStep[];
  readonly contractChecks: readonly ContractCheck[];
};

export type {
  AnalysisReadFilter,
  ContractCallCheck,
  ContractCheck,
  MockTool,
  MockToolRegistry,
  Scenario,
  TestRun,
  TestRunAnalysisRecord,
  TestRunInput,
  TestRunResult,
  TestRunStatus,
  TestRunToolUse,
  TranscriptStep,
} from "./test-run.types";
export {
  createMockToolRegistry,
  defaultMockToolRegistry,
  emailMockTool,
} from "./mock-tool-registry";
export {
  computeContractChecks,
  contractCheckIssues,
  registryFromContracts,
} from "./contract-checks";
export { executeSkill, TEST_RUN_WORLD_GENERATOR_VERSION } from "./execute-skill";
export { analysisReadLimit, toTestRunAnalysisRecord } from "./analysis-read";
export type { TestRunRepository } from "./test-run.repository";

const testRunEvaluator: Evaluator<TestRunInput, TestRunResult> = {
  kind: "test-run",
  evaluate: (input, gateway, observer) =>
    // A test run is user-attributable work → `account` tag, declaring the
    // `test-run` capability so usage gates it against the right cap. The
    // evaluator builds its own scenario + registry inside executeSkill (method).
    executeSkill({
      skill: input.skill,
      toolContracts: input.toolContracts,
      responseSchemas: input.responseSchemas,
      gateway,
      tag: { kind: "account", userId: input.skill.userId, capability: "test-run" },
      observer,
    }),
};

/** Insights — default, friendly: the model-written interpretation, with the
 * deterministic contract-check issues merged into `watch` so a mismatched or
 * missing tool call always surfaces, whatever the model chose to mention. */
const insightsRenderer: Renderer<TestRunResult, Insight> = {
  target: "insights",
  render: (a) => {
    const issues = contractCheckIssues(a.contractChecks).filter(
      (issue) => !a.insight.watch.includes(issue),
    );
    return issues.length === 0 ? a.insight : { ...a.insight, watch: [...a.insight.watch, ...issues] };
  },
};

/** Breakdown — depth on demand: scenario, raw transcript, contract checks. */
const breakdownRenderer: Renderer<TestRunResult, TestRunBreakdown> = {
  target: "breakdown",
  render: (a) => ({
    scenario: a.scenario,
    transcript: a.transcript,
    contractChecks: a.contractChecks,
  }),
};

export const testRunCapability = defineEvaluation({
  name: "test run",
  evaluator: testRunEvaluator,
  renderers: {
    insights: insightsRenderer,
    breakdown: breakdownRenderer,
  },
});
