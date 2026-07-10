import type {
  Publication,
  PublicationSafetyRating,
  PublicationSafetyState,
  PublicationTier,
} from "./publication.types";

export type SkillLibrarySurface = "library" | "templates";

export type SkillLibraryEntry = {
  readonly name: string;
  readonly owner: string;
  readonly slug: string;
  readonly tier: PublicationTier;
  readonly trustLabel: string;
  readonly safety: PublicationSafetyState;
  readonly surfaced: boolean;
  readonly contentHash: string;
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
    readonly safetyRatings?: readonly PublicationSafetyRating[];
  } = {},
): SkillLibraryView {
  const surface = options.surface ?? "library";
  const query = normalizeSearch(options.query ?? "");
  const slug = options.slug?.trim().toLowerCase();

  const entries = publications
    .filter((publication) => publication.tier === "published" || publication.tier === "reviewed")
    .map((publication) => renderSkillLibraryEntry(publication, safetyFor(publication, options.safetyRatings ?? [])))
    .filter((entry) => {
      if (slug) return entry.slug.toLowerCase() === slug;
      if (!entry.surfaced) return false;
      if (!query) return true;
      return normalizeSearch(`${entry.name} ${entry.owner} ${entry.slug}`).includes(query);
    })
    .sort((a, b) => a.slug.localeCompare(b.slug));

  return { surface, entries };
}

function renderSkillLibraryEntry(publication: Publication, safety: PublicationSafetyState): SkillLibraryEntry {
  const [owner, name] = splitSlug(publication.slug);
  return {
    name,
    owner,
    slug: publication.slug,
    tier: publication.tier,
    trustLabel: trustLabel(publication.tier),
    safety,
    surfaced: publication.tier === "reviewed",
    contentHash: publication.contentHash,
    source: {
      type: "git",
      ref: "HEAD",
      path: `skills/${publication.slug}`,
    },
  };
}

function trustLabel(tier: PublicationTier): string {
  if (tier === "published") return "published skill";
  if (tier === "reviewed") return "reviewed skill - human-reviewed";
  return "private skill";
}

function safetyFor(
  publication: Publication,
  ratings: readonly PublicationSafetyRating[],
): PublicationSafetyState {
  const rating = ratings.find(
    (candidate) =>
      candidate.skillVersionId === publication.skillVersionId &&
      candidate.verdict === "passed",
  );
  if (!rating) {
    return {
      status: "potentially-unsafe",
      label: "potentially unsafe — not validated",
      ratingId: null,
    };
  }
  return {
    status: "safety-badge",
    label: "safety badge",
    ratingId: rating.ratingId,
  };
}

function splitSlug(slug: string): [owner: string, name: string] {
  const [owner, ...rest] = slug.split("/");
  return [owner ?? "", rest.join("/")];
}

function normalizeSearch(value: string): string {
  return value.trim().toLowerCase();
}
