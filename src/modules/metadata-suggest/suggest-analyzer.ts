import { z } from "zod";
import {
  SKILL_CATEGORIES,
  isSkillCategory,
  normalizeSkillTags,
  skillMetadata,
  type Skill,
  type SkillCategory,
} from "@/modules/skill";
import type { AnalysisContext, Analyzer } from "@/modules/skill-analysis";
import { isErr, ok } from "@/shared";
import type { SkillMetadataSuggestion } from "./metadata-suggest.types";

/**
 * Read a skill → suggest discovery metadata (category + tags).
 *
 * Same posture as visualise's IR extraction: an analysis capability that stays
 * usable offline. With a gateway + tag the model reads the whole skill and
 * recommends; without one, a deterministic keyword scorer keeps the surface
 * alive. Either way the artifact is a suggestion — the author decides what is
 * written.
 */
export const suggestAnalyzer: Analyzer<Skill, SkillMetadataSuggestion> = {
  kind: "skill-metadata",
  async analyze(skill: Skill, context?: AnalysisContext) {
    const current = skillMetadata(skill.source);
    const gateway = context?.gateway;

    if (gateway?.hasModel && context?.tag) {
      const generated = await gateway.generate({
        system:
          "You classify Agent Skills for a skill library. Recommend discovery metadata grounded only in the supplied SKILL.md — never invent capability the skill does not describe.",
        prompt: modelPrompt(skill),
        schema: suggestionSchema,
        tag: context.tag,
      });
      if (!isErr(generated)) {
        return ok({
          kind: "skill-metadata" as const,
          category: generated.value.category,
          tags: normalizeSkillTags(generated.value.tags),
          rationale: generated.value.rationale,
          current,
        });
      }
    }

    return ok({ ...fallbackSuggestion(skill), current });
  },
};

const suggestionSchema = z.object({
  category: z.enum(SKILL_CATEGORIES),
  tags: z.array(z.string().min(1).max(40)).min(1).max(8),
  rationale: z.string().min(1).max(300),
});

function modelPrompt(skill: Skill): string {
  return `Recommend a category and tags for this skill.

Rules:
- category must be one of: ${SKILL_CATEGORIES.join(", ")}.
- 3 to 6 tags, lowercase hyphen-case, each a term a user would search for.
- Tags name the workflow, artifact, or domain — not generic words like "assistant" or "helper".
- rationale is one short sentence a non-technical author understands.

SKILL.md:
---
name: ${skill.source.frontmatter.name}
description: ${skill.source.frontmatter.description}
---

${skill.source.body}`;
}

/** Deterministic offline fallback: keyword scoring over name + description + body. */
function fallbackSuggestion(
  skill: Skill,
): Omit<SkillMetadataSuggestion, "current"> {
  const haystack =
    `${skill.source.frontmatter.name} ${skill.source.frontmatter.description} ${skill.source.body}`.toLowerCase();

  let best: { category: SkillCategory; score: number } | null = null;
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    const score = keywords.reduce(
      (sum, keyword) => sum + occurrences(haystack, keyword),
      0,
    );
    if (score > 0 && (best === null || score > best.score)) {
      best = { category: category as SkillCategory, score };
    }
  }

  const tags = normalizeSkillTags(
    contentWords(skill.source.frontmatter.description).slice(0, 5),
  );

  return {
    kind: "skill-metadata",
    category: best?.category ?? null,
    tags,
    rationale: best
      ? `Suggested from the skill's own wording — it talks mostly about ${best.category.replace("-", " ")}.`
      : "No category stood out from the skill's wording — pick one from the list.",
  };
}

const CATEGORY_KEYWORDS: Readonly<Record<SkillCategory, readonly string[]>> = {
  email: ["email", "inbox", "unread", "reply", "newsletter"],
  calendar: ["calendar", "schedule", "scheduling", "appointment", "availability", "week"],
  meetings: ["meeting", "minutes", "transcript", "agenda", "attendees"],
  documents: ["document", "policy", "procedure document", "summarise", "summarize", "pdf"],
  finance: ["invoice", "expense", "receipt", "payment", "tax", "bookkeeping", "budget"],
  legal: ["contract", "clause", "liability", "legal", "terms"],
  sales: ["lead", "customer follow", "quote", "prospect", "deal", "crm"],
  marketing: ["campaign", "social", "caption", "brand", "post", "audience"],
  "customer-support": ["support", "faq", "ticket", "complaint", "customer question"],
  hiring: ["hiring", "job posting", "candidate", "onboarding", "new hire", "recruit"],
  operations: ["procedure", "checklist", "sop", "vendor", "supplier", "stocktake"],
  writing: ["draft", "proofread", "edit", "tone", "grammar", "report"],
  analysis: ["analyze", "analyse", "extract", "classify", "themes", "data"],
  travel: ["travel", "trip", "itinerary", "flight", "hotel"],
  development: ["code", "repository", "deploy", "test suite", "pull request", "api"],
};

function occurrences(haystack: string, needle: string): number {
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

const STOP_WORDS = new Set([
  "a", "an", "and", "for", "from", "in", "into", "of", "or", "the", "to", "use",
  "with", "skill", "when", "user", "their", "your",
]);

function contentWords(text: string): string[] {
  return (
    text
      .toLowerCase()
      .match(/[a-z][a-z0-9-]{3,}/g)
      ?.filter((word) => !STOP_WORDS.has(word)) ?? []
  );
}
