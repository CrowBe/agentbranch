import { parseSkillMd } from "@/modules/skill";
import { parseResponseSchema } from "@/modules/response-schema";
import { parseToolContract } from "@/modules/tool-contract";
import { parseSubagentDefinition } from "@/modules/subagent-definition";
import type { ImportClassification, ImportPrimitiveKind } from "./import.types";

const ALL_KINDS: readonly ImportPrimitiveKind[] = [
  "skill",
  "subagent-definition",
  "tool-contract",
  "response-schema",
];

/**
 * Recognise which primitive a pasted document is, using each primitive's own
 * source model rather than a private heuristic — the parsers are the authority
 * on what their format accepts.
 *
 * Two documents can be the same bytes: markdown carrying only `name` +
 * `description` satisfies both `parseSkillMd` and `parseSubagentDefinition`.
 * The winner is the first match in ascending format-specificity order, and
 * every other match is reported in `alternatives` so the caller can ask instead
 * of filing the user's work under a guess.
 */
export function classifyImportDocument(
  raw: string,
  options: { readonly candidates?: readonly ImportPrimitiveKind[] } = {},
): ImportClassification {
  const candidates = options.candidates ?? ALL_KINDS;
  const matches = ALL_KINDS.filter((kind) => candidates.includes(kind)).flatMap((kind) => {
    const name = nameIfParseable(kind, raw);
    return name === null ? [] : [{ kind, name }];
  });

  if (matches.length === 0) {
    return { ok: false, message: unrecognisedMessage(candidates) };
  }

  const [best, ...rest] = ordered(matches, raw);
  if (best === undefined) return { ok: false, message: unrecognisedMessage(candidates) };
  return {
    ok: true,
    kind: best.kind,
    name: best.name,
    // A reading the format itself resolved is not an open question, so it is
    // not offered back as an alternative — only genuinely competing readings
    // are, and those are the ones worth asking the user about.
    alternatives: resolvedByFormat(raw) ? [] : rest.map((match) => match.kind),
  };
}

/**
 * True when the document carries vocabulary only one primitive defines, so the
 * competing parse is an accident of overlapping formats rather than real doubt.
 */
function resolvedByFormat(raw: string): boolean {
  const definition = parseSubagentDefinition(raw);
  return (
    definition.ok &&
    (definition.value.frontmatter.tools !== undefined ||
      definition.value.frontmatter.model !== undefined)
  );
}

/**
 * The winner is the most *specific* format the bytes satisfy. `tools` or
 * `model` in frontmatter is subagent-only vocabulary, so its presence resolves
 * the markdown ambiguity outright; without it a markdown document reads as a
 * skill first, because that is the primitive a user is most likely holding.
 */
function ordered(
  matches: readonly { kind: ImportPrimitiveKind; name: string }[],
  raw: string,
): readonly { kind: ImportPrimitiveKind; name: string }[] {
  const subagentSpecific = resolvedByFormat(raw);

  const rank = (kind: ImportPrimitiveKind): number => {
    if (kind === "subagent-definition") return subagentSpecific ? 0 : 2;
    if (kind === "skill") return 1;
    if (kind === "tool-contract") return 0;
    return 3;
  };

  return [...matches].sort((left, right) => rank(left.kind) - rank(right.kind));
}

function nameIfParseable(kind: ImportPrimitiveKind, raw: string): string | null {
  if (kind === "skill") {
    const parsed = parseSkillMd(raw);
    return parsed.ok ? parsed.value.frontmatter.name : null;
  }
  if (kind === "subagent-definition") {
    const parsed = parseSubagentDefinition(raw);
    return parsed.ok ? parsed.value.frontmatter.name : null;
  }
  if (kind === "tool-contract") {
    const parsed = parseToolContract(raw);
    return parsed.ok ? parsed.value.name : null;
  }
  const parsed = parseResponseSchema(raw);
  return parsed.ok ? responseSchemaName(parsed.value.document) : null;
}

function responseSchemaName(document: { readonly title?: unknown }): string {
  return typeof document.title === "string" && document.title.trim().length > 0
    ? document.title.trim()
    : "untitled schema";
}

function unrecognisedMessage(candidates: readonly ImportPrimitiveKind[]): string {
  const names = candidates.map(readableKind);
  const listed =
    names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
  return `This doesn't look like ${listed} yet - check the format and try again.`;
}

export function readableKind(kind: ImportPrimitiveKind): string {
  if (kind === "skill") return "a SKILL.md";
  if (kind === "subagent-definition") return "a subagent definition";
  if (kind === "tool-contract") return "a tool contract";
  return "a response schema";
}
