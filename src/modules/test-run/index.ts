/**
 * test-run — run a skill against mocked tools (ARCHITECTURE §2, §5.4).
 *
 * User-facing term is always "test run", never "sandbox". The mechanism is the
 * mock-tool registry; the agent tool is `execute_skill`. Nothing real is ever
 * touched.
 *
 * An **evaluation capability** on the seam: the evaluator owns its method
 * (builds its own Scenario + mock-tool registry, composes `gateway.runAgent`
 * with the mocks as tool handlers); the model gateway is handed in. Its artifact
 * is the `TestRunResult` — rendered to Insights (the friendly surface lands in
 * build-out step d; the `result` surface returns the raw artifact meanwhile).
 */
import { defineEvaluation } from "@/modules/skill-analysis";
import type { Evaluator } from "@/modules/skill-analysis";
import { executeSkill } from "./execute-skill";
import type { TestRunResult } from "./test-run.types";

export type {
  MockTool,
  MockToolRegistry,
  Scenario,
  TestRun,
  TestRunResult,
  TestRunStatus,
  TranscriptStep,
} from "./test-run.types";
export {
  createMockToolRegistry,
  defaultMockToolRegistry,
  emailMockTool,
} from "./mock-tool-registry";
export { executeSkill } from "./execute-skill";
export type { TestRunRepository } from "./test-run.repository";

const testRunEvaluator: Evaluator<TestRunResult> = {
  kind: "test-run",
  evaluate: (skill, gateway) =>
    // A test run is user-attributable work → `account` tag. The evaluator builds
    // its own scenario + registry inside executeSkill (its method).
    executeSkill({ skill, gateway, tag: { kind: "account", userId: skill.userId } }),
};

export const testRunCapability = defineEvaluation({
  name: "test run",
  evaluator: testRunEvaluator,
  renderers: {
    /** Interim raw-artifact surface; Insights renderer lands in step (d). */
    result: { target: "result", render: (a: TestRunResult) => a },
  },
});
