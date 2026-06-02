import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { ok, err, type Result } from "@/shared";
import type { Frontmatter, SkillSource, SkillError } from "./skill.types";

const FRONTMATTER_FENCE = "---";

/**
 * Parse a raw SKILL.md string into structured frontmatter + body.
 *
 * The format is a leading `---` fenced YAML block followed by the markdown
 * body. `name` and `description` are required; any other frontmatter keys are
 * preserved in `extra` so the round-trip is lossless.
 */
export function parseSkillMd(raw: string): Result<SkillSource, SkillError> {
  const { yamlText, body } = splitFrontmatter(raw);

  let parsed: unknown;
  try {
    parsed = yamlText.trim().length > 0 ? parseYaml(yamlText) : {};
  } catch (cause) {
    return err({
      tag: "invalid_frontmatter",
      message: `Could not parse frontmatter YAML: ${String(cause)}`,
    });
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return err({
      tag: "invalid_frontmatter",
      message: "Frontmatter must be a YAML mapping.",
    });
  }

  const record = parsed as Record<string, unknown>;
  const { name, description, ...extra } = record;

  if (typeof name !== "string" || name.trim().length === 0) {
    return err({ tag: "missing_name", message: "Frontmatter is missing a `name`." });
  }
  if (typeof description !== "string" || description.trim().length === 0) {
    return err({
      tag: "missing_description",
      message: "Frontmatter is missing a `description`.",
    });
  }

  const frontmatter: Frontmatter = { name, description, extra };
  return ok({ frontmatter, body: body.replace(/^\n+/, "") });
}

/**
 * Serialize structured frontmatter + body back into a SKILL.md string.
 * Inverse of `parseSkillMd` for any source it produced.
 */
export function serializeSkillMd(source: SkillSource): string {
  const { name, description, extra } = source.frontmatter;
  const yamlText = stringifyYaml({ name, description, ...extra }).trimEnd();
  return `${FRONTMATTER_FENCE}\n${yamlText}\n${FRONTMATTER_FENCE}\n\n${source.body}`;
}

/** Split a raw document into its (possibly empty) YAML block and markdown body. */
function splitFrontmatter(raw: string): { yamlText: string; body: string } {
  const normalized = raw.replace(/\r\n/g, "\n");
  if (!normalized.startsWith(FRONTMATTER_FENCE)) {
    return { yamlText: "", body: normalized };
  }
  const closingIndex = normalized.indexOf(`\n${FRONTMATTER_FENCE}`, FRONTMATTER_FENCE.length);
  if (closingIndex === -1) {
    return { yamlText: "", body: normalized };
  }
  const yamlText = normalized.slice(FRONTMATTER_FENCE.length, closingIndex);
  const afterFence = normalized.slice(closingIndex + 1 + FRONTMATTER_FENCE.length);
  return { yamlText, body: afterFence };
}
