import { serializeSkillMd, type Skill } from "@/modules/skill";
import type { Analyzer, Renderer } from "@/modules/skill-analysis";
import { ok } from "@/shared";
import type { ExportArtifact, ExportManifest } from "./export.types";

/** Read a skill → export artifact (its instruction intent + identity). */
export const exportAnalyzer: Analyzer<ExportArtifact> = {
  kind: "export",
  async analyze(skill: Skill) {
    return ok({ kind: "export" as const, source: skill.source });
  },
};

/**
 * Render the Claude `.zip` manifest: the proper skill directory
 * `skillname/SKILL.md` (+ refs later). The installable artifact is this
 * directory zipped; copy serves the paste-it case (ARCHITECTURE §4).
 */
export const claudeRenderer: Renderer<ExportArtifact, ExportManifest> = {
  target: "claude",
  render: (artifact) => {
    const dir = slug(artifact.source.frontmatter.name);
    return {
      target: "claude",
      rootDir: dir,
      files: [{ path: `${dir}/SKILL.md`, contents: serializeSkillMd(artifact.source) }],
    };
  },
};

/** Lowercase, hyphenated directory name for the skill. */
function slug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "skill";
}
