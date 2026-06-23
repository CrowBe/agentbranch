import { parseSkillMd, serializeSkillMd, type Skill } from "@/modules/skill";
import type { Analyzer, Renderer } from "@/modules/skill-analysis";
import { domainError, err, ok } from "@/shared";
import type { ExportArtifact, ExportManifest } from "./export.types";

/** Read a skill -> export artifact (its instruction intent + identity). */
export const exportAnalyzer: Analyzer<Skill, ExportArtifact> = {
  kind: "export",
  async analyze(skill: Skill) {
    const serialized = serializeSkillMd(skill.source);
    const validation = parseSkillMd(serialized);
    if (!validation.ok) {
      return err(
        domainError(
          "seam_analyze_failed",
          `Export requires a valid standard SKILL.md: ${validation.error.message}`,
          validation.error,
        ),
      );
    }

    return ok({ kind: "export" as const, source: validation.value });
  },
};

/**
 * Render the standard Agent Skills folder manifest: `skillname/SKILL.md` (+ refs
 * later). The installable artifact is this directory zipped; copy serves the
 * paste-it case (ARCHITECTURE §4).
 */
export const standardRenderer: Renderer<ExportArtifact, ExportManifest> = {
  target: "standard",
  render: (artifact) => {
    const dir = slug(artifact.source.frontmatter.name);
    return {
      target: "standard",
      rootDir: dir,
      files: [{ path: `${dir}/SKILL.md`, contents: serializeSkillMd(artifact.source) }],
    };
  },
};

/** Lowercase, hyphenated directory name for the skill. */
function slug(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "skill"
  );
}
