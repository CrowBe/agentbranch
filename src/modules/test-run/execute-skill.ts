import { z } from "zod";
import type { Skill } from "@/modules/skill";
import { skillDescription, skillName } from "@/modules/skill";
import type { ModelGateway, AccountingTag, GatewayTool } from "@/modules/model-gateway";
import { insightSchema } from "@/modules/skill-analysis";
import { ok, isErr, type Result, type DomainError } from "@/shared";
import { createMockToolRegistry, defaultMockToolRegistry } from "./mock-tool-registry";
import type {
  MockTool,
  MockToolRegistry,
  Scenario,
  TestRunResult,
  TranscriptStep,
} from "./test-run.types";

const INSIGHT_TRANSCRIPT_TEXT_MAX = 600;

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
  const world =
    input.registry && input.scenario
      ? ok({ registry: input.registry, scenario: input.scenario })
      : await generatedWorld(skill, gateway, input.registry, input.scenario);
  if (isErr(world)) return world;

  const { registry, scenario } = world.value;

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

const WORLD_SYSTEM = `You design deterministic test-run inputs for Claude Skills.
Infer the mock tools the skill would need, create realistic mock responses that
stress the skill, and write one user request that exercises the skill. Return
only data that is safe to use in a mock environment.`;

export const TEST_RUN_WORLD_GENERATOR_VERSION = {
  system: WORLD_SYSTEM,
  schema: "scenario.prompt:max500;scenario.seedData:record;mockTools:min1-max4",
} as const;

function insightPrompt(
  name: string,
  prompt: string,
  transcript: readonly TranscriptStep[],
): string {
  const steps = transcript
    .map((s) =>
      s.kind === "model"
        ? `model: ${clampText(s.text, INSIGHT_TRANSCRIPT_TEXT_MAX)}`
        : s.kind === "tool-call"
          ? `tool-call: ${s.tool}(${clampJson(s.input, INSIGHT_TRANSCRIPT_TEXT_MAX)})`
          : `tool-result: ${s.tool} → ${clampJson(s.output, INSIGHT_TRANSCRIPT_TEXT_MAX)}`,
    )
    .join("\n");
  return `Skill "${name}" was test-run on: "${clampText(prompt, INSIGHT_TRANSCRIPT_TEXT_MAX)}".\n\nWhat happened:\n${steps}`;
}

async function generatedWorld(
  skill: Skill,
  gateway: ModelGateway,
  registryOverride?: MockToolRegistry,
  scenarioOverride?: Scenario,
): Promise<Result<{ registry: MockToolRegistry; scenario: Scenario }, DomainError>> {
  const key = worldCacheKey(skill);
  const cached = generatedWorldCache.get(key);
  if (cached) {
    return ok({
      registry: registryOverride ?? registryFromGenerated(cached.mockTools),
      scenario: scenarioOverride ?? cached.scenario,
    });
  }

  const generated = await gateway.generate({
    system: WORLD_SYSTEM,
    prompt: worldPrompt(skill),
    schema: generatedWorldSchema,
    tag: { kind: "platform", reason: "test-run mock world generation" },
  });
  if (isErr(generated)) return generated;

  const normalized = normalizeGeneratedWorld(generated.value, skill);
  generatedWorldCache.set(key, normalized);
  return ok({
    registry: registryOverride ?? registryFromGenerated(normalized.mockTools),
    scenario: scenarioOverride ?? normalized.scenario,
  });
}

function worldPrompt(skill: Skill): string {
  const body = skill.source.body.slice(0, 5000);
  return `Skill name: ${skillName(skill)}
Description: ${skillDescription(skill)}

SKILL.md body:
${body}

Return:
- one realistic user prompt that should make this skill run;
- seed data used by that prompt;
- 1-4 mock tools inferred from the skill's instructions.

If the skill mentions email/inbox, include a read_email mock. If it mentions
another integration, infer a clear tool name for that integration.`;
}

const generatedMockToolSchema = z.object({
  name: z.string().min(1).max(60).regex(/^[A-Za-z][A-Za-z0-9_-]*$/),
  description: z.string().min(1).max(240),
  response: z.unknown(),
});

const generatedWorldSchema = z.object({
  scenario: z.object({
    prompt: z.string().min(1).max(500),
    seedData: z.record(z.string(), z.unknown()),
  }),
  mockTools: z.array(generatedMockToolSchema).min(1).max(4),
});

type GeneratedWorld = z.infer<typeof generatedWorldSchema>;

const generatedWorldCache = new Map<string, GeneratedWorld>();

function normalizeGeneratedWorld(world: GeneratedWorld, skill: Skill): GeneratedWorld {
  const mockTools = dedupeMockTools(world.mockTools);
  return {
    scenario: {
      prompt: world.scenario.prompt.trim() || `Use the "${skillName(skill)}" skill.`,
      seedData: world.scenario.seedData,
    },
    mockTools: mockTools.length > 0 ? mockTools : fallbackGeneratedWorld().mockTools,
  };
}

function dedupeMockTools(tools: readonly GeneratedWorld["mockTools"][number][]) {
  const seen = new Set<string>();
  const deduped: GeneratedWorld["mockTools"] = [];
  for (const tool of tools) {
    const name = tool.name.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    deduped.push({ ...tool, name, description: tool.description.trim() });
  }
  return deduped;
}

function registryFromGenerated(tools: readonly GeneratedWorld["mockTools"][number][]) {
  const mocks: MockTool[] = tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    respond: () => tool.response,
  }));
  return createMockToolRegistry(mocks.length > 0 ? mocks : defaultMockToolRegistry().list());
}

function fallbackGeneratedWorld(): GeneratedWorld {
  const email = defaultMockToolRegistry().list()[0];
  return {
    scenario: {
      prompt: "Use this skill to triage the unread invoice email and recommend the next step.",
      seedData: {},
    },
    mockTools: [
      {
        name: email?.name ?? "read_email",
        description: email?.description ?? "Returns mocked unread email.",
        response: email?.respond({}) ?? {},
      },
    ],
  };
}

function clampJson(value: unknown, max: number): string {
  return clampText(JSON.stringify(value) ?? "undefined", max);
}

function clampText(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function worldCacheKey(skill: Skill): string {
  return [
    skill.id,
    skill.updatedAt.getTime(),
    skillName(skill),
    skillDescription(skill),
    skill.source.body,
  ].join("\0");
}
