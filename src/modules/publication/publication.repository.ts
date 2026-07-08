import type { DomainError, PublicationId, Result, SkillVersionId, UserId } from "@/shared";
import type { Publication, PublishSkillVersionInput } from "./publication.types";

/**
 * Persistence port for the publication domain. Adapters enforce ownership at
 * write time: a user can publish only a version of their own Skill record.
 */
export interface PublicationRepository {
  create(input: PublishSkillVersionInput): Promise<Result<Publication, DomainError>>;

  findById(id: PublicationId): Promise<Result<Publication | null, DomainError>>;

  findBySlug(slug: string): Promise<Result<Publication | null, DomainError>>;

  listByPublisher(publisherId: UserId): Promise<Result<readonly Publication[], DomainError>>;

  listByVersion(skillVersionId: SkillVersionId): Promise<Result<readonly Publication[], DomainError>>;
}
