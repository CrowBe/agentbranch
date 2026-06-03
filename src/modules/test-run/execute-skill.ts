import type { Skill } from "@/modules/skill";
import { skillName } from "@/modules/skill";
import type { ModelGateway, AccountingTag, GatewayTool } from "@/modules/model-gateway";
import { insightSchema } from "@/modules/skill-analysis";
import { ok, isErr, type Result, type DomainError } from "@/shared";
import { defaultMockToolRegistry } from "./mock-tool-registry";
import type {
  MockToolRegistry,
  Scenario,
  TestRunResult,
  TranscriptStep,
} from "./test-run.types";

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
  if (isErr(turn)) return turn;

  // Turn the raw transcript into a plain-language Insight (one bounded call).
  const insight = await gateway.generate({
    system: INSIGHT_SYSTEM,
    prompt: insightPrompt(skillName(skill), scenario.prompt, turn.value.transcript),
    schema: insightSchema,
    tag,
  });
  if (isErr(insight)) return insight;

  return ok({
    kind: "test-run",
    scenario,
    transcript: turn.value.transcript,
    insight: insight.value,
  });
}

const SYSTEM_PROMPT = `You are running a skill in a test environment. Follow the
skill's instructions against the user's request, calling the available tools as
needed. The tools return mock data — nothing real is touched.`;

const INSIGHT_SYSTEM = `You explain a skill's test-run to its author in plain
language — warm, concrete, no jargon. The author may be non-technical. Say what
the skill did with the request, whether it behaved sensibly, and flag anything
worth adjusting.`;

function insightPrompt(
  name: string,
  prompt: string,
  transcript: readonly TranscriptStep[],
): string {
  const steps = transcript
    .map((s) =>
      s.kind === "model"
        ? `model: ${s.text}`
        : s.kind === "tool-call"
          ? `tool-call: ${s.tool}(${JSON.stringify(s.input)})`
          : `tool-result: ${s.tool} → ${JSON.stringify(s.output)}`,
    )
    .join("\n");
  return `Skill "${name}" was test-run on: "${prompt}".\n\nWhat happened:\n${steps}`;
}

/** A default scenario derived from the skill (1 per run in v1, ARCHITECTURE §4). */
function defaultScenario(skill: Skill): Scenario {
  return { prompt: `Use the "${skillName(skill)}" skill to handle my request.`, seedData: {} };
}
