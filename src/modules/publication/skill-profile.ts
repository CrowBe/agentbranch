import { skillMetadata } from "@/modules/skill";
import { safetyFor, splitSlug, trustLabel } from "./skill-library";
import type {
  PublicationSafetyRating,
  PublicationSafetyState,
  PublicationTier,
  TapRepositorySkill,
} from "./publication.types";

/**
 * The public profile of one published skill version — everything its page
 * states: identity, trust tier, safety badge or potentially-unsafe label,
 * discovery metadata, and the install source. Pure render over the pinned
 * version (same honesty rule as the badge: the page can never describe content
 * it doesn't match, because everything derives from the pinned source + hash).
 */
export type SkillProfileView = {
  readonly name: string;
  readonly owner: string;
  readonly slug: string;
  readonly tier: PublicationTier;
  readonly trustLabel: string;
  readonly safety: PublicationSafetyState;
  readonly contentHash: string;
  readonly description: string;
  readonly category: string | null;
  readonly tags: readonly string[];
  readonly publishedAt: string;
  readonly install: {
    readonly type: "git";
    readonly ref: "HEAD";
    readonly path: string;
  };
};

export function renderSkillProfile(
  skill: TapRepositorySkill,
  options: { readonly safetyRatings?: readonly PublicationSafetyRating[] } = {},
): SkillProfileView {
  const { publication, source } = skill;
  const [owner, name] = splitSlug(publication.slug);
  const metadata = skillMetadata(source);

  return {
    name,
    owner,
    slug: publication.slug,
    tier: publication.tier,
    trustLabel: trustLabel(publication.tier),
    safety: safetyFor(publication, options.safetyRatings ?? []),
    contentHash: publication.contentHash,
    description: source.frontmatter.description,
    category: metadata.category,
    tags: metadata.tags,
    publishedAt: publication.createdAt.toISOString(),
    install: {
      type: "git",
      ref: "HEAD",
      path: `skills/${publication.slug}`,
    },
  };
}
