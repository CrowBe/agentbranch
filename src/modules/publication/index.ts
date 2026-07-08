/**
 * publication — public address records for validated Skill versions.
 *
 * A Publication pins one append-only Skill version, its content hash, a
 * publisher-owned slug, trust tier, and the gate run that allowed it
 * (ARCHITECTURE §9.1). Distribution surfaces build on this later.
 */
export type {
  Publication,
  PublicationGateBinding,
  PublicationGateVerdict,
  PublicationSlug,
  PublicationTier,
  PublishSkillVersionInput,
} from "./publication.types";
export type { PublicationRepository } from "./publication.repository";
export { publishSkillVersion, renderPublicationSlug } from "./publish-skill-version";
