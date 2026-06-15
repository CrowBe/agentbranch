import type { SkillSource } from "@/modules/skill";
import type { Artifact } from "@/modules/skill-analysis";

/** Export target: the standard Agent Skills folder, installable across compatible runtimes. */
export type ExportTarget = "standard";

/** A single file in an export package. */
export type ExportFile = {
  readonly path: string;
  readonly contents: string;
};

/**
 * The installable package, described as files under a root directory. The
 * actual `.zip` bytes are produced from this at the edge (stubbed for now) —
 * the manifest is the export-agnostic contract (ARCHITECTURE §6).
 */
export type ExportManifest = {
  readonly target: ExportTarget;
  readonly rootDir: string;
  readonly files: readonly ExportFile[];
};

/** The seam artifact for export: the skill's instruction intent + identity. */
export type ExportArtifact = Artifact<"export"> & {
  readonly source: SkillSource;
};
