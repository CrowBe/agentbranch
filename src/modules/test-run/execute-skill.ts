import type { Skill } from "@/modules/skill";
import { skillName } from "@/modules/skill";
import type { ModelGateway, AccountingTag, GatewayTool } from "@/modules/model-gateway";
import { mapResult, type Result, type DomainError } from "@/shared";
import { defaultMockToolRegistry } from "./mock-tool-registry";
import type { MockToolRegistry, Scenario, TestRunResult } from "./test-run.types";

/**
 * Run a skill against the mock-tool registry and return a test-run result.
 *
 * Method (the evaluator owns this): build the world the skill runs in — a
 * Scenario and a mock-tool registry (inferred from the skill; v1 defaults to the
 * email mock, override optional, per ARCHITECTURE §4) — then drive the skill
 * through the gateway's `runAgent` primitive. The registry's mock tools become
 * the agent's tool *handlers*: the gateway runs the loop, but each tool's
 * behaviour is ours, so nothing real is ever touched. The gateway is pure
 * resource; this composes the test run from one primitive.
 */
export async function executeSkill(input: {
  skill: Skill;
  gateway: ModelGateway;
  tag: AccountingTag;
  /** Optional overrides; both default to the evaluator's inferred world. */
  scenario?: Scenario;
  registry?: MockToolRegistry;
}): Promise<Result<TestRunResult, DomainError>> {
  const { skill, gateway, tag } = input;
  const registry = input.registry ?? defaultMockToolRegistry();
  const scenario = input.scenario ?? defaultScenario(skill);

  const tools: GatewayTool[] = registry.list().map((t) => ({
    name: t.name,
    description: t.description,
    parameters: { type: "object", properties: {}, additionalProperties: true },
    handler: (toolInput) => t.respond(toolInput),
  }));

  const turn = await gateway.runAgent({
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: scenario.prompt }],
    tools,
    tag,
  });

  return mapResult(turn, (t) => ({
    kind: "test-run",
    scenario,
    transcript: t.transcript,
  }));
}

const SYSTEM_PROMPT = `You are running a skill in a test environment. Follow the
skill's instructions against the user's request, calling the available tools as
needed. The tools return mock data — nothing real is touched.`;

/** A default scenario derived from the skill (1 per run in v1, ARCHITECTURE §4). */
function defaultScenario(skill: Skill): Scenario {
  return { prompt: `Use the "${skillName(skill)}" skill to handle my request.`, seedData: {} };
}
