import { createHash } from "node:crypto";
import { serializeSkillMd } from "@/modules/skill";
import { domainError, err, ok, type DomainError, type Result } from "@/shared";
import type {
  Publication,
  PublicationSafetyRating,
  TapRepositoryFile,
  TapRepositorySkill,
} from "./publication.types";
import { renderTapMarketplace } from "./tap-marketplace";

/**
 * Render the file set a public tap bot PR writes: the standard skill folders
 * plus the regenerated marketplace index. Hash mismatches stop before any file
 * content is emitted, so a publication cannot accidentally point at different
 * `SKILL.md` bytes than the manifest advertises.
 */
export function renderTapRepositoryFiles(
  skills: readonly TapRepositorySkill[],
  safetyRatings: readonly PublicationSafetyRating[] = [],
): Result<readonly TapRepositoryFile[], DomainError> {
  const visibleSkills = skills.filter(({ publication }) => isVisible(publication));
  const skillFiles: TapRepositoryFile[] = [];

  for (const { publication, source } of visibleSkills) {
    const content = serializeSkillMd(source);
    const contentHash = sha256(content);
    if (contentHash !== publication.contentHash) {
      return err(domainError(
        "invalid_operation",
        `Published skill ${publication.slug} has content hash ${publication.contentHash}, but the rendered SKILL.md is ${contentHash}.`,
      ));
    }
    skillFiles.push({
      path: `skills/${publication.slug}/SKILL.md`,
      content,
    });
  }

  const manifest = renderTapMarketplace(
    visibleSkills.map(({ publication }) => publication),
    safetyRatings,
  );

  return ok([
    {
      path: ".claude-plugin/marketplace.json",
      content: `${JSON.stringify(manifest, null, 2)}\n`,
    },
    ...skillFiles.sort((a, b) => a.path.localeCompare(b.path)),
  ]);
}

function isVisible(publication: Publication): boolean {
  return publication.tier === "published" || publication.tier === "reviewed";
}

function sha256(content: string): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}
