/**
 * visualise — skill IR → Mermaid (ARCHITECTURE §3.1, §4).
 *
 * A Capability on the seam. The IR (nodes+edges+source-spans) is the stable
 * contract; v1 renders it to Mermaid, the later canvas to React Flow — same
 * artifact, swapped renderer.
 */
import { defineCapability } from "@/modules/skill-analysis";
import { irAnalyzer } from "./extract-ir";
import { mermaidRenderer, type MermaidSource } from "./mermaid-renderer";
import type { SkillIR } from "./ir.types";

export const visualiseCapability = defineCapability<SkillIR, { mermaid: MermaidSource }>({
  name: "visualise",
  analyzer: irAnalyzer,
  renderers: { mermaid: mermaidRenderer },
});

export type { SkillIR, IrNode, IrEdge, IrNodeKind, MermaidDiagram } from "./ir.types";
export type { MermaidSource } from "./mermaid-renderer";
