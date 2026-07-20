import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { err, ok, type Result } from "@/shared";
import type {
  SubagentDefinitionError,
  SubagentDefinitionSource,
} from "./subagent-definition.types";

const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export function parseSubagentDefinition(
  raw: string,
): Result<SubagentDefinitionSource, SubagentDefinitionError> {
  const normalized = raw.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) {
    return err({ tag: "invalid_frontmatter", message: "A subagent definition must start with YAML frontmatter." });
  }
  const closing = normalized.indexOf("\n---", 4);
  if (closing === -1) {
    return err({ tag: "invalid_frontmatter", message: "Could not find the closing frontmatter fence." });
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(normalized.slice(4, closing));
  } catch {
    return err({ tag: "invalid_frontmatter", message: "Could not parse frontmatter YAML." });
  }
  if (!isRecord(parsed)) {
    return err({ tag: "invalid_frontmatter", message: "Frontmatter must be a YAML mapping." });
  }
  if (findUnsafeKey(parsed)) {
    return err({ tag: "invalid_frontmatter", message: "Frontmatter contains an unsafe key." });
  }

  const { name, description, tools, model, ...extra } = parsed;
  if (typeof name !== "string" || name.trim().length === 0) {
    return err({ tag: "missing_name", message: "Frontmatter is missing a `name`." });
  }
  if (typeof description !== "string" || description.trim().length === 0) {
    return err({ tag: "missing_description", message: "Frontmatter is missing a `description`." });
  }
  if (tools !== undefined && (!Array.isArray(tools) || !tools.every((tool) => typeof tool === "string"))) {
    return err({ tag: "invalid_frontmatter", message: "Frontmatter `tools` must be a list of tool names." });
  }
  if (model !== undefined && typeof model !== "string") {
    return err({ tag: "invalid_frontmatter", message: "Frontmatter `model` must be a string." });
  }

  return ok({
    frontmatter: { name, description, tools: tools as string[] | undefined, model, extra },
    body: normalized.slice(closing + 4).replace(/^\n+/, ""),
  });
}

export function serializeSubagentDefinition(source: SubagentDefinitionSource): string {
  const { name, description, tools, model, extra } = source.frontmatter;
  const frontmatter = {
    name,
    description,
    ...(tools === undefined ? {} : { tools }),
    ...(model === undefined ? {} : { model }),
    ...extra,
  };
  return `---\n${stringifyYaml(frontmatter).trimEnd()}\n---\n\n${source.body}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function findUnsafeKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(findUnsafeKey);
  if (!isRecord(value)) return false;
  return Object.entries(value).some(([key, child]) => UNSAFE_KEYS.has(key) || findUnsafeKey(child));
}
