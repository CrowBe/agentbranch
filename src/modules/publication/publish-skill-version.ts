import type { RequestRateLimiter } from "@/modules/usage";
import { REQUEST_RATE_LIMIT } from "@/modules/usage";
import { domainError, err, isErr, ok, type DomainError, type Result } from "@/shared";
import type { PublicationRepository } from "./publication.repository";
import type { Publication, PublishSkillVersionInput, PublicationSlug } from "./publication.types";

export type PublishSkillVersionDeps = {
  readonly publications: PublicationRepository;
  readonly requestRateLimiter: RequestRateLimiter;
};

export async function publishSkillVersion(
  deps: PublishSkillVersionDeps,
  input: PublishSkillVersionInput,
): Promise<Result<Publication, DomainError>> {
  const slug = normalizeSlug(input.slug);
  if (!slug) {
    return err(domainError("invalid_operation", "Publication slug must be owner/skill-name."));
  }
  if (input.contentHash.trim().length === 0) {
    return err(domainError("invalid_operation", "Publication content hash is required."));
  }
  if (input.tier !== "private" && input.gate.verdict !== "passed") {
    return err(domainError("invalid_operation", "Community or reviewed publication requires a passed gate run."));
  }

  const rate = await deps.requestRateLimiter.consume(input.publisherId, "publish", REQUEST_RATE_LIMIT);
  if (isErr(rate)) return rate;
  if (!rate.value.allowed) {
    return err(domainError("cap_reached", rate.value.reason));
  }

  return deps.publications.create({ ...input, slug });
}

function normalizeSlug(slug: PublicationSlug): PublicationSlug | null {
  const owner = slug.owner.trim().toLowerCase();
  const name = slug.name.trim().toLowerCase();
  if (!SLUG_PART.test(owner) || !SLUG_PART.test(name)) return null;
  return { owner, name };
}

const SLUG_PART = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

export function renderPublicationSlug(slug: PublicationSlug): string {
  return `${slug.owner}/${slug.name}`;
}
