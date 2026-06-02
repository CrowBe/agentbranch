import type { Skill } from "@/modules/skill";
import { ok, type Result, type DomainError } from "@/shared";
import type {
  MockToolRegistry,
  Scenario,
  TranscriptStep,
} from "./test-run.types";

/**
 * Run a skill against the mock-tool registry and return a transcript.
 *
 * STUB: v1 drives this through the build loop's model with `execute_skill`,
 * intercepting tool calls into the registry (ARCHITECTURE §3). Here it emits a
 * deterministic transcript by invoking each registered mock once, so the
 * test-run surface and the registry seam are exercisable without a model. The
 * port shape (skill + scenario + registry → transcript) is the real contract.
 */
export async function executeSkill(input: {
  skill: Skill;
  scenario: Scenario;
  registry: MockToolRegistry;
}): Promise<Result<readonly TranscriptStep[], DomainError>> {
  const { scenario, registry } = input;
  const steps: TranscriptStep[] = [
    { kind: "model", text: `Reading the request: "${scenario.prompt}"` },
  ];

  for (const tool of registry.list()) {
    steps.push({ kind: "tool-call", tool: tool.name, input: scenario.seedData });
    steps.push({ kind: "tool-result", tool: tool.name, output: tool.respond(scenario.seedData) });
  }

  steps.push({ kind: "model", text: "Drafted a response. Nothing real was touched." });
  return ok(steps);
}
