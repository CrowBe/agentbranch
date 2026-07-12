import { normalizeSkillTag, skillMetadata } from "@/modules/skill";
import type {
  Publication,
  PublicationSafetyRating,
  PublicationSafetyState,
  PublicationTier,
  TapRepositorySkill,
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
  /** Discovery metadata from the pinned version's frontmatter; null when the
   * pinned source was not supplied to the renderer. */
  readonly description: string | null;
  readonly category: string | null;
  readonly tags: readonly string[];
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
    /** Category filter — matches the taxonomy value in the pinned frontmatter. */
    readonly category?: string;
    /** Tag filter — normalized before matching, so `Inbox Zero` finds `inbox-zero`. */
    readonly tag?: string;
    readonly safetyRatings?: readonly PublicationSafetyRating[];
    /** Pinned version sources (the tap repository read); powers description /
     * category / tags on entries and the metadata filters above. */
    readonly sources?: readonly TapRepositorySkill[];
  } = {},
): SkillLibraryView {
  const surface = options.surface ?? "library";
  const query = normalizeSearch(options.query ?? "");
  const slug = options.slug?.trim().toLowerCase();
  const category = normalizeSearch(options.category ?? "");
  const tag = normalizeSkillTag(options.tag ?? "");
  const sourceByPublication = new Map(
    (options.sources ?? []).map((entry) => [entry.publication.id, entry.source]),
  );

  const entries = publications
    .filter((publication) => publication.tier === "published" || publication.tier === "reviewed")
    .map((publication) =>
      renderSkillLibraryEntry(
        publication,
        safetyFor(publication, options.safetyRatings ?? []),
        sourceByPublication.get(publication.id) ?? null,
      ),
    )
    .filter((entry) => {
      if (slug) return entry.slug.toLowerCase() === slug;
      if (!entry.surfaced) return false;
      if (category && entry.category !== category) return false;
      if (tag && !entry.tags.includes(tag)) return false;
      if (!query) return true;
      return normalizeSearch(
        `${entry.name} ${entry.owner} ${entry.slug} ${entry.description ?? ""} ${entry.category ?? ""} ${entry.tags.join(" ")}`,
      ).includes(query);
    })
    .sort((a, b) => a.slug.localeCompare(b.slug));

  return { surface, entries };
}

function renderSkillLibraryEntry(
  publication: Publication,
  safety: PublicationSafetyState,
  source: TapRepositorySkill["source"] | null,
): SkillLibraryEntry {
  const [owner, name] = splitSlug(publication.slug);
  const metadata = source === null ? null : skillMetadata(source);
  return {
    name,
    owner,
    slug: publication.slug,
    tier: publication.tier,
    trustLabel: trustLabel(publication.tier),
    safety,
    surfaced: publication.tier === "reviewed",
    contentHash: publication.contentHash,
    description: source?.frontmatter.description ?? null,
    category: metadata?.category ?? null,
    tags: metadata?.tags ?? [],
    source: {
      type: "git",
      ref: "HEAD",
      path: `skills/${publication.slug}`,
    },
  };
}

export function trustLabel(tier: PublicationTier): string {
  if (tier === "published") return "published skill";
  if (tier === "reviewed") return "reviewed skill - human-reviewed";
  return "private skill";
}

export function safetyFor(
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

export function splitSlug(slug: string): [owner: string, name: string] {
  const [owner, ...rest] = slug.split("/");
  return [owner ?? "", rest.join("/")];
}

function normalizeSearch(value: string): string {
  return value.trim().toLowerCase();
}
