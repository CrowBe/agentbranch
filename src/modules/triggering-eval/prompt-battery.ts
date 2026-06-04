import { z } from "zod";
import type { Skill } from "@/modules/skill";
import { skillDescription, skillName } from "@/modules/skill";
import type { AccountingTag, ModelGateway } from "@/modules/model-gateway";
import { isErr, ok, type DomainError, type Result } from "@/shared";
import type { PromptCase } from "./triggering-eval.types";

/**
 * Build the positive/negative prompt battery for a skill.
 *
 * STUB: v1 generates these from the skill via the model. Here we derive a tiny
 * deterministic battery from the description keywords so the eval runner is
 * exercisable offline. The shape (positive + negative cases) is the real contract.
 */
export function buildPromptBattery(skill: Skill): readonly PromptCase[] {
  const keyword = firstKeyword(skill.source.frontmatter.description) ?? skillName(skill);
  return [
    { prompt: `Can you help me ${keyword}?`, expected: "fire" },
    { prompt: `I need to ${keyword} right now.`, expected: "fire" },
    { prompt: "What's the weather like today?", expected: "silent" },
    { prompt: "Translate this paragraph into French.", expected: "silent" },
  ];
}

/**
 * Generate the positive/negative prompt battery from the skill itself.
 *
 * The triggering eval is account-attributable model work, so the caller passes
 * the same tag used for the classify/insight calls. Generated cases are cached
 * by the skill version identity so re-runs are deterministic.
 */
export async function generatePromptBattery(
  skill: Skill,
  gateway: ModelGateway,
  tag: AccountingTag,
): Promise<Result<readonly PromptCase[], DomainError>> {
  const key = promptBatteryCacheKey(skill);
  const cached = promptBatteryCache.get(key);
  if (cached) return ok(cached);

  const generated = await gateway.generate({
    system: PROMPT_BATTERY_SYSTEM,
    prompt: promptBatteryPrompt(skill),
    schema: promptBatterySchema,
    tag,
  });
  if (isErr(generated)) return generated;

  const battery = normalizePromptBattery(generated.value);
  promptBatteryCache.set(key, battery);
  return ok(battery);
}

function firstKeyword(description: string): string | undefined {
  return description
    .toLowerCase()
    .split(/[^a-z]+/)
    .find((word) => word.length > 4 && !STOPWORDS.has(word));
}

const STOPWORDS = new Set(["should", "their", "about", "which", "would", "there"]);

const promptBatterySchema = z.object({
  positive: z
    .array(z.string().min(1))
    .min(2)
    .max(5)
    .describe("Prompts that should trigger this skill."),
  negative: z
    .array(z.string().min(1))
    .min(2)
    .max(5)
    .describe("Near-miss or off-topic prompts where this skill should stay silent."),
});

type GeneratedPromptBattery = z.infer<typeof promptBatterySchema>;

const promptBatteryCache = new Map<string, readonly PromptCase[]>();

const PROMPT_BATTERY_SYSTEM = `You design a small triggering-eval prompt battery
for a Claude Skill. Create realistic user requests that test whether the skill
should fire. Positives must clearly need this skill. Negatives should include
plausible near-misses, not only unrelated requests.`;

function promptBatteryPrompt(skill: Skill): string {
  const body = skill.source.body.slice(0, 3000);
  return `Skill name: ${skillName(skill)}
Description: ${skillDescription(skill)}

SKILL.md body:
${body}

Return 3 positive prompts and 3 negative prompts. Keep each prompt under 160 characters.`;
}

function normalizePromptBattery(generated: GeneratedPromptBattery): readonly PromptCase[] {
  return [
    ...uniquePrompts(generated.positive).map((prompt) => ({ prompt, expected: "fire" as const })),
    ...uniquePrompts(generated.negative).map((prompt) => ({ prompt, expected: "silent" as const })),
  ];
}

function uniquePrompts(prompts: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const prompt of prompts) {
    const trimmed = prompt.trim();
    const key = trimmed.toLowerCase();
    if (!trimmed || seen.has(key)) continue;
    seen.add(key);
    unique.push(trimmed);
  }
  return unique;
}

function promptBatteryCacheKey(skill: Skill): string {
  return [
    skill.id,
    skill.updatedAt.getTime(),
    skillName(skill),
    skillDescription(skill),
    skill.source.body,
  ].join("\0");
}
