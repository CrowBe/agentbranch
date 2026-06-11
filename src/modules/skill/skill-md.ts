import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import {
  ok,
  err,
  FRONTMATTER_JSON_MAX_BYTES,
  FRONTMATTER_JSON_MAX_DEPTH,
  FRONTMATTER_JSON_MAX_KEYS,
  LIMIT_MESSAGES,
  SKILL_BODY_MAX,
  SKILL_DESCRIPTION_MAX,
  SKILL_NAME_MAX,
  type Result,
} from "@/shared";
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
  } catch {
    return err({
      tag: "invalid_frontmatter",
      message: "Could not parse frontmatter YAML.",
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
  const extraValidation = validateFrontmatterJson(extra);
  if (extraValidation !== null) {
    return err({ tag: "invalid_frontmatter", message: extraValidation });
  }

  if (typeof name !== "string" || name.trim().length === 0) {
    return err({ tag: "missing_name", message: "Frontmatter is missing a `name`." });
  }
  if (name.length > SKILL_NAME_MAX) {
    return err({ tag: "invalid_frontmatter", message: LIMIT_MESSAGES.skillName });
  }
  if (typeof description !== "string" || description.trim().length === 0) {
    return err({
      tag: "missing_description",
      message: "Frontmatter is missing a `description`.",
    });
  }
  if (description.length > SKILL_DESCRIPTION_MAX) {
    return err({ tag: "invalid_frontmatter", message: LIMIT_MESSAGES.skillDescription });
  }
  const normalizedBody = body.replace(/^\n+/, "");
  if (normalizedBody.length > SKILL_BODY_MAX) {
    return err({ tag: "invalid_frontmatter", message: LIMIT_MESSAGES.skillBody });
  }

  const frontmatter: Frontmatter = { name, description, extra };
  return ok({ frontmatter, body: normalizedBody });
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

/** Apply a streamed edit literally, without interpreting `$` replacement tokens. */
export function applySkillEdit(
  source: SkillSource,
  oldStr: string,
  newStr: string,
): Result<SkillSource, SkillError> {
  if (oldStr.length === 0) {
    return err({
      tag: "edit_no_match",
      message: "Could not apply the streamed edit because the target text was empty.",
    });
  }

  const raw = serializeSkillMd(source);
  const start = raw.indexOf(oldStr);
  if (start === -1) {
    return err({
      tag: "edit_no_match",
      message: "Could not apply the streamed edit because the target text was not found.",
    });
  }

  const nextRaw = `${raw.slice(0, start)}${newStr}${raw.slice(start + oldStr.length)}`;
  const parsed = parseSkillMd(nextRaw);
  if (!parsed.ok) {
    return err({
      tag: "edit_invalid_skill",
      message: parsed.error.message,
    });
  }
  return parsed;
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

const UNSAFE_FRONTMATTER_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function validateFrontmatterJson(value: unknown): string | null {
  const seen = new WeakSet<object>();
  const structuralError = visitFrontmatterValue(value, 0, { keyCount: 0 }, seen);
  if (structuralError !== null) return structuralError;

  const serialized = JSON.stringify(value);
  if (serialized === undefined) return LIMIT_MESSAGES.frontmatterJson;
  if (new TextEncoder().encode(serialized).length > FRONTMATTER_JSON_MAX_BYTES) {
    return LIMIT_MESSAGES.frontmatterJson;
  }

  return null;
}

function visitFrontmatterValue(
  value: unknown,
  depth: number,
  state: { keyCount: number },
  seen: WeakSet<object>,
): string | null {
  if (depth > FRONTMATTER_JSON_MAX_DEPTH) return LIMIT_MESSAGES.frontmatterJson;

  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return null;
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) return LIMIT_MESSAGES.frontmatterJson;
    seen.add(value);
    for (const item of value) {
      const itemError = visitFrontmatterValue(item, depth + 1, state, seen);
      if (itemError !== null) return itemError;
    }
    return null;
  }

  if (typeof value !== "object") return LIMIT_MESSAGES.frontmatterJson;
  if (seen.has(value)) return LIMIT_MESSAGES.frontmatterJson;
  seen.add(value);

  for (const [key, child] of Object.entries(value)) {
    if (UNSAFE_FRONTMATTER_KEYS.has(key)) return LIMIT_MESSAGES.unsafeFrontmatterKey;
    state.keyCount += 1;
    if (state.keyCount > FRONTMATTER_JSON_MAX_KEYS) return LIMIT_MESSAGES.frontmatterJson;

    const childError = visitFrontmatterValue(child, depth + 1, state, seen);
    if (childError !== null) return childError;
  }

  return null;
}
