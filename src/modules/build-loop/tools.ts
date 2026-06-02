import { tool } from "ai";
import { z } from "zod";
import { parseSkillMd } from "@/modules/skill";

/**
 * The authoring tools the model calls. `write_skill` streams the whole doc on a
 * first draft; `edit_skill` applies a highlighted diff on revisions — cheaper
 * tokens, and the preview is a doc model supporting replace + patch
 * (ARCHITECTURE §4). Their `execute` returns a normalised payload the loop maps
 * to `skill` / `skill-edit` events.
 */
export const buildTools = {
  write_skill: tool({
    description:
      "Write the full SKILL.md (YAML frontmatter + markdown body) on a first draft.",
    inputSchema: z.object({
      content: z.string().describe("The complete SKILL.md document."),
    }),
    execute: async ({ content }) => {
      const parsed = parseSkillMd(content);
      return parsed.ok
        ? { ok: true as const, content }
        : { ok: false as const, error: parsed.error.message };
    },
  }),

  edit_skill: tool({
    description:
      "Apply a targeted edit to the current SKILL.md by replacing an exact string.",
    inputSchema: z.object({
      oldStr: z.string().describe("Exact text to replace."),
      newStr: z.string().describe("Replacement text."),
    }),
    execute: async ({ oldStr, newStr }) => ({ ok: true as const, oldStr, newStr }),
  }),
};

export type BuildToolName = keyof typeof buildTools;
