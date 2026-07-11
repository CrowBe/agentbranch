import type { PublicationRepository, PublishSkillVersionInput, Publication } from "@/modules/publication";
import {
  domainError,
  err,
  ok,
  PublicationId,
  type SkillVersionId,
  type UserId,
} from "@/shared";
import type { MemorySkillStore } from "./skill.memory-repository";

/** In-memory PublicationRepository — keeps the app bootable without Postgres. */
export function createMemoryPublicationRepository(store: MemorySkillStore): PublicationRepository {
  const publications = new Map<string, Publication>();

  function ownsVersion(input: Pick<PublishSkillVersionInput, "publisherId" | "skillId" | "skillVersionId">) {
    const skill = store.skills.get(input.skillId);
    return (
      skill?.userId === input.publisherId &&
      (store.versions.get(input.skillId) ?? []).some((version) => version.id === input.skillVersionId)
    );
  }

  return {
    async create(input) {
      if (!ownsVersion(input)) {
        return err(domainError("not_found", `No skill version ${input.skillVersionId}.`));
      }
      const slug = `${input.slug.owner}/${input.slug.name}`;
      if ([...publications.values()].some((publication) => publication.slug === slug)) {
        return err(domainError("invalid_operation", `Publication slug ${slug} already exists.`));
      }
      const publication: Publication = {
        id: PublicationId(crypto.randomUUID()),
        publisherId: input.publisherId,
        skillId: input.skillId,
        skillVersionId: input.skillVersionId,
        slug,
        tier: input.tier,
        contentHash: input.contentHash,
        createdAt: new Date(),
      };
      publications.set(publication.id, publication);
      return ok(publication);
    },

    async findById(id) {
      return ok(publications.get(id) ?? null);
    },

    async findBySlug(slug) {
      return ok([...publications.values()].find((publication) => publication.slug === slug) ?? null);
    },

    async listVisible() {
      return ok(
        [...publications.values()].filter(
          (publication) => publication.tier === "published" || publication.tier === "reviewed",
        ),
      );
    },

    async listTapRepositorySkills() {
      const visible = [...publications.values()].filter(
        (publication) => publication.tier === "published" || publication.tier === "reviewed",
      );
      return ok(
        visible.flatMap((publication) => {
          const source = (store.versions.get(publication.skillId) ?? []).find(
            (version) => version.id === publication.skillVersionId,
          )?.source;
          return source ? [{ publication, source }] : [];
        }),
      );
    },

    async listByPublisher(publisherId: UserId) {
      return ok([...publications.values()].filter((publication) => publication.publisherId === publisherId));
    },

    async listByVersion(skillVersionId: SkillVersionId) {
      return ok([...publications.values()].filter((publication) => publication.skillVersionId === skillVersionId));
    },
  };
}
