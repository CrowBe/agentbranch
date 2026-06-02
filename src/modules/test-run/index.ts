/**
 * test-run — run a skill against mocked tools (ARCHITECTURE §2, §5.4).
 *
 * User-facing term is always "test run", never "sandbox". The mechanism is the
 * mock-tool registry; the agent tool is `execute_skill`. Nothing real is ever
 * touched.
 */
export type {
  MockTool,
  MockToolRegistry,
  Scenario,
  TestRun,
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
