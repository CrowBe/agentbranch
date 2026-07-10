import type {
  Publication,
  PublicationSafetyRating,
  PublicationSafetyState,
  TapMarketplaceManifest,
  TapMarketplaceSkill,
} from "./publication.types";

/**
 * Render the public tap marketplace index. The bot PR flow can write this to
 * `.claude-plugin/marketplace.json`; consumers install from HEAD, so removing
 * an entry by revert ends installability immediately.
 */
export function renderTapMarketplace(
  publications: readonly Publication[],
  safetyRatings: readonly PublicationSafetyRating[] = [],
): TapMarketplaceManifest {
  return {
    version: 1,
    skills: publications
      .filter((publication) => publication.tier === "published" || publication.tier === "reviewed")
      .map((publication) => renderTapMarketplaceSkill(publication, safetyFor(publication, safetyRatings)))
      .sort((a, b) => a.slug.localeCompare(b.slug)),
  };
}

function renderTapMarketplaceSkill(publication: Publication, safety: PublicationSafetyState): TapMarketplaceSkill {
  const [owner, name] = splitSlug(publication.slug);
  return {
    name,
    owner,
    slug: publication.slug,
    tier: publication.tier,
    contentHash: publication.contentHash,
    safety,
    source: {
      type: "git",
      ref: "HEAD",
      path: `skills/${publication.slug}`,
    },
  };
}

function splitSlug(slug: string): [owner: string, name: string] {
  const [owner, ...rest] = slug.split("/");
  return [owner ?? "", rest.join("/")];
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
