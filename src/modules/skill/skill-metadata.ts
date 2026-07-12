import type { SkillSource } from "./skill.types";

/**
 * The closed category taxonomy — the "classes" skills are filed, filtered, and
 * ranked within (one page per "top skill in its class" rides on it). Closed so
 * filtering stays meaningful: a free-string category is a warning in lint, not
 * a new shelf. Extend the list here when a real cluster of skills needs one.
 */
export const SKILL_CATEGORIES = [
  "email",
  "calendar",
  "meetings",
  "documents",
  "finance",
  "legal",
  "sales",
  "marketing",
  "customer-support",
  "hiring",
  "operations",
  "writing",
  "analysis",
  "travel",
  "development",
] as const;

export type SkillCategory = (typeof SKILL_CATEGORIES)[number];

/** Structural bound on tags per skill — enough to search on, few enough to mean something. */
export const SKILL_TAGS_MAX = 8;

const TAG_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/**
 * A skill's discovery metadata, read from `SKILL.md` frontmatter (`category` +
 * `tags` extra keys). Frontmatter is the one home so metadata travels with the
 * standard-native artifact — it exports, imports, and publishes with the skill
 * and is pinned by the same content hash as everything else.
 *
 * `category` is returned as written (validation is lint's job — see the
 * `metadata.*` rules); use `isSkillCategory` where only taxonomy values make
 * sense (filters, suggestions).
 */
export type SkillMetadata = {
  readonly category: string | null;
  readonly tags: readonly string[];
};

export function isSkillCategory(value: unknown): value is SkillCategory {
  return (
    typeof value === "string" && (SKILL_CATEGORIES as readonly string[]).includes(value)
  );
}

/** Read `category` + `tags` from a source's frontmatter extra keys. Tolerant on
 * shape (a YAML list or a comma-separated string both read as tags) so authored
 * and imported skills meet the same reader. */
export function skillMetadata(source: SkillSource): SkillMetadata {
  const extra = source.frontmatter.extra;
  const category = typeof extra.category === "string" ? extra.category.trim() || null : null;
  return { category, tags: readTags(extra.tags) };
}

/**
 * Return a new source with `category` / `tags` written into frontmatter.
 * Normalizing write, lossless everywhere else: tags are kebab-cased and
 * deduped, empty values remove their key so untagged skills stay clean.
 */
export function withSkillMetadata(
  source: SkillSource,
  metadata: { readonly category?: string | null; readonly tags?: readonly string[] },
): SkillSource {
  const extra: Record<string, unknown> = { ...source.frontmatter.extra };

  if (metadata.category !== undefined) {
    const category = metadata.category?.trim() ?? "";
    if (category.length === 0) delete extra.category;
    else extra.category = category;
  }

  if (metadata.tags !== undefined) {
    const tags = normalizeSkillTags(metadata.tags);
    if (tags.length === 0) delete extra.tags;
    else extra.tags = tags;
  }

  return { ...source, frontmatter: { ...source.frontmatter, extra } };
}

/** Kebab-case one tag: trim, lowercase, spaces/underscores → hyphens. */
export function normalizeSkillTag(tag: string): string {
  return tag
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Normalize a tag list: kebab-case, drop empties, dedupe, cap at `SKILL_TAGS_MAX`. */
export function normalizeSkillTags(tags: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  for (const tag of tags) {
    const normalized = normalizeSkillTag(tag);
    if (normalized.length === 0) continue;
    seen.add(normalized);
    if (seen.size === SKILL_TAGS_MAX) break;
  }
  return [...seen];
}

/** Is this tag already in the shape `normalizeSkillTag` produces? */
export function isNormalizedSkillTag(tag: string): boolean {
  return TAG_PATTERN.test(tag);
}

function readTags(value: unknown): readonly string[] {
  if (Array.isArray(value)) {
    return value.filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0).map((tag) => tag.trim());
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0);
  }
  return [];
}
