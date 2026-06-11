/**
 * export — render an installable package from a skill (ARCHITECTURE §4, §5.6).
 *
 * A Capability on the seam. v1 = the standard skill folder `.zip`, authored
 * and validated through the Claude-first renderer.
 */
import { defineCapability } from "@/modules/skill-analysis";
import { exportAnalyzer, claudeRenderer } from "./claude-export";
import type { ExportArtifact, ExportManifest } from "./export.types";

export const exportCapability = defineCapability<ExportArtifact, { claude: ExportManifest }>({
  name: "export",
  analyzer: exportAnalyzer,
  renderers: { claude: claudeRenderer },
});

export type { ExportTarget, ExportFile, ExportManifest, ExportArtifact } from "./export.types";
