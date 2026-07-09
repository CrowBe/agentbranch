import type { Publication, TapMarketplaceManifest, TapMarketplaceSkill } from "./publication.types";

/**
 * Render the public tap marketplace index. The bot PR flow can write this to
 * `.claude-plugin/marketplace.json`; consumers install from HEAD, so removing
 * an entry by revert ends installability immediately.
 */
export function renderTapMarketplace(publications: readonly Publication[]): TapMarketplaceManifest {
  return {
    version: 1,
    skills: publications
      .filter((publication) => publication.tier === "community" || publication.tier === "reviewed")
      .map(renderTapMarketplaceSkill)
      .sort((a, b) => a.slug.localeCompare(b.slug)),
  };
}

function renderTapMarketplaceSkill(publication: Publication): TapMarketplaceSkill {
  const [owner, name] = splitSlug(publication.slug);
  return {
    name,
    owner,
    slug: publication.slug,
    tier: publication.tier,
    contentHash: publication.contentHash,
    gate: publication.gate,
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
