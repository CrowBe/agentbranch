/**
 * export — render an installable package from a skill (ARCHITECTURE §4, §5.6).
 *
 * A Capability on the seam. v1 = the standard Agent Skills folder `.zip`,
 * runtime-neutral and validated as SKILL.md at export time.
 */
import { defineCapability } from "@/modules/skill-analysis";
import { exportAnalyzer, standardRenderer } from "./standard-export";
import type { ExportArtifact, ExportManifest } from "./export.types";

export const exportCapability = defineCapability({
  name: "export",
  analyzer: exportAnalyzer,
  renderers: { standard: standardRenderer },
});

export type { ExportTarget, ExportFile, ExportManifest, ExportArtifact } from "./export.types";
