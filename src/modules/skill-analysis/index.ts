/**
 * skill-analysis — the seam / spine (ARCHITECTURE §3.1).
 *
 * The shared pattern *read skill → emit artifact → render for a surface*,
 * built once. New capabilities ask "what renderer is this?" and plug in here;
 * they never grow a new pipeline. Visualise, the Rendered/Source hero, Export
 * and Triggering eval are all Capabilities on this seam.
 */
export type {
  SourceSpan,
  Artifact,
  Analyzer,
  Renderer,
  Capability,
} from "./seam.types";
export { defineCapability, runCapability } from "./seam";
