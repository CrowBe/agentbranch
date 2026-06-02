import type { Artifact, SourceSpan } from "@/modules/skill-analysis";

/** The role a node plays in the skill's logic — drives shape/colour later. */
export type IrNodeKind = "start" | "step" | "decision" | "constraint" | "end";

/** One node of the skill IR, carrying a span back into SKILL.md (ARCHITECTURE §2). */
export type IrNode = {
  readonly id: string;
  readonly label: string;
  readonly kind: IrNodeKind;
  readonly span: SourceSpan;
};

export type IrEdge = {
  readonly from: string;
  readonly to: string;
  readonly label?: string;
};

export type MermaidDiagram = "flowchart" | "sequence" | "stateDiagram";

/**
 * The skill IR — *one* artifact type on the seam (ARCHITECTURE §2). The stable
 * contract the later interactive canvas (React Flow) reuses; node ↔ source
 * mapping is paid once here.
 */
export type SkillIR = Artifact<"skill-ir"> & {
  readonly diagram: MermaidDiagram;
  readonly nodes: readonly IrNode[];
  readonly edges: readonly IrEdge[];
};
