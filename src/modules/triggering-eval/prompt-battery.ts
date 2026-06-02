import type { Skill } from "@/modules/skill";
import { skillName } from "@/modules/skill";
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

function firstKeyword(description: string): string | undefined {
  return description
    .toLowerCase()
    .split(/[^a-z]+/)
    .find((word) => word.length > 4 && !STOPWORDS.has(word));
}

const STOPWORDS = new Set(["should", "their", "about", "which", "would", "there"]);
