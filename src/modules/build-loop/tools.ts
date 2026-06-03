import { parseSkillMd } from "@/modules/skill";
import type { GatewayTool } from "@/modules/model-gateway";

/**
 * The authoring tools the model calls, in the model gateway's `GatewayTool`
 * shape (JSON-schema params + a caller-supplied `handler`). `write_skill`
 * streams the whole doc on a first draft; `edit_skill` applies a highlighted
 * diff on revisions — cheaper tokens, and the preview is a doc model supporting
 * replace + patch (ARCHITECTURE §4). Each `handler` returns a normalised payload
 * the loop maps to `skill` / `skill-edit` events.
 */
export const buildTools: readonly GatewayTool[] = [
  {
    name: "write_skill",
    description:
      "Write the full SKILL.md (YAML frontmatter + markdown body) on a first draft.",
    parameters: {
      type: "object",
      properties: {
        content: { type: "string", description: "The complete SKILL.md document." },
      },
      required: ["content"],
      additionalProperties: false,
    },
    handler: (input) => {
      const content = typeof input.content === "string" ? input.content : "";
      const parsed = parseSkillMd(content);
      return parsed.ok
        ? { ok: true as const, content }
        : { ok: false as const, error: parsed.error.message };
    },
  },
  {
    name: "edit_skill",
    description:
      "Apply a targeted edit to the current SKILL.md by replacing an exact string.",
    parameters: {
      type: "object",
      properties: {
        oldStr: { type: "string", description: "Exact text to replace." },
        newStr: { type: "string", description: "Replacement text." },
      },
      required: ["oldStr", "newStr"],
      additionalProperties: false,
    },
    handler: (input) => ({
      ok: true as const,
      oldStr: typeof input.oldStr === "string" ? input.oldStr : "",
      newStr: typeof input.newStr === "string" ? input.newStr : "",
    }),
  },
];

export type BuildToolName = "write_skill" | "edit_skill";
