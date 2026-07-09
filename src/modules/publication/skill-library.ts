import type { Publication, PublicationGateBinding, PublicationTier } from "./publication.types";

export type SkillLibrarySurface = "library" | "templates";

export type SkillLibraryEntry = {
  readonly name: string;
  readonly owner: string;
  readonly slug: string;
  readonly tier: PublicationTier;
  readonly trustLabel: string;
  readonly surfaced: boolean;
  readonly contentHash: string;
  readonly gate: PublicationGateBinding;
  readonly source: {
    readonly type: "git";
    readonly ref: "HEAD";
    readonly path: string;
  };
};

export type SkillLibraryView = {
  readonly surface: SkillLibrarySurface;
  readonly entries: readonly SkillLibraryEntry[];
};

export function renderSkillLibrary(
  publications: readonly Publication[],
  options: {
    readonly surface?: SkillLibrarySurface;
    readonly query?: string;
    readonly slug?: string;
  } = {},
): SkillLibraryView {
  const surface = options.surface ?? "library";
  const query = normalizeSearch(options.query ?? "");
  const slug = options.slug?.trim().toLowerCase();

  const entries = publications
    .filter((publication) => publication.tier === "community" || publication.tier === "reviewed")
    .map(renderSkillLibraryEntry)
    .filter((entry) => {
      if (slug) return entry.slug.toLowerCase() === slug;
      if (!entry.surfaced) return false;
      if (!query) return true;
      return normalizeSearch(`${entry.name} ${entry.owner} ${entry.slug}`).includes(query);
    })
    .sort((a, b) => a.slug.localeCompare(b.slug));

  return { surface, entries };
}

function renderSkillLibraryEntry(publication: Publication): SkillLibraryEntry {
  const [owner, name] = splitSlug(publication.slug);
  return {
    name,
    owner,
    slug: publication.slug,
    tier: publication.tier,
    trustLabel: trustLabel(publication.tier),
    surfaced: publication.tier === "reviewed",
    contentHash: publication.contentHash,
    gate: publication.gate,
    source: {
      type: "git",
      ref: "HEAD",
      path: `skills/${publication.slug}`,
    },
  };
}

function trustLabel(tier: PublicationTier): string {
  if (tier === "community") {
    return "community skill - automated checks passed, not human-reviewed";
  }
  if (tier === "reviewed") return "reviewed skill - human-reviewed";
  return "private skill";
}

function splitSlug(slug: string): [owner: string, name: string] {
  const [owner, ...rest] = slug.split("/");
  return [owner ?? "", rest.join("/")];
}

function normalizeSearch(value: string): string {
  return value.trim().toLowerCase();
}
