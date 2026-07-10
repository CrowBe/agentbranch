/**
 * publication — public address records for published Skill versions.
 *
 * A Publication pins one append-only Skill version, its content hash, a
 * publisher-owned slug, and trust tier (ARCHITECTURE §9.1). Badge/flag state
 * is rendered from the version's safety rating.
 */
export type {
  Publication,
  PublicationSafetyRating,
  PublicationSafetyState,
  PublicationSlug,
  PublicationTier,
  PublishSkillVersionInput,
  TapMarketplaceManifest,
  TapMarketplaceSkill,
} from "./publication.types";
export type { PublicationRepository } from "./publication.repository";
export { publishSkillVersion, renderPublicationSlug } from "./publish-skill-version";
export { renderTapMarketplace } from "./tap-marketplace";
export { renderSkillLibrary } from "./skill-library";
export type { SkillLibraryEntry, SkillLibrarySurface, SkillLibraryView } from "./skill-library";
