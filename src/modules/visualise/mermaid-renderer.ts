import type { Renderer } from "@/modules/skill-analysis";
import type { SkillIR, IrNode } from "./ir.types";

/** The Mermaid surface: a source string a client renders to SVG. */
export type MermaidSource = { readonly mermaid: string };

/**
 * IR → Mermaid. The thin v1 renderer (ARCHITECTURE §4); the later interactive
 * canvas swaps this for an IR→React Flow renderer over the *same* IR.
 */
export const mermaidRenderer: Renderer<SkillIR, MermaidSource> = {
  target: "mermaid",
  render: (ir) => {
    if (ir.diagram === "sequence") return { mermaid: renderSequence(ir) };
    if (ir.diagram === "stateDiagram") return { mermaid: renderState(ir) };

    const lines = ["flowchart TD"];
    for (const node of ir.nodes) lines.push(`  ${safeId(node.id)}${shape(node)}`);
    for (const edge of ir.edges) {
      const label = edge.label ? `|${escape(edge.label)}|` : "";
      lines.push(`  ${safeId(edge.from)} -->${label} ${safeId(edge.to)}`);
    }
    return { mermaid: lines.join("\n") };
  },
};

function renderSequence(ir: SkillIR): string {
  const lines = ["sequenceDiagram", "  participant User", "  participant Skill"];
  for (const node of ir.nodes) {
    if (node.kind === "start" || node.kind === "end") continue;
    lines.push(`  User->>Skill: ${escape(node.label)}`);
  }
  return lines.join("\n");
}

function renderState(ir: SkillIR): string {
  const lines = ["stateDiagram-v2"];
  for (const node of ir.nodes) lines.push(`  ${safeId(node.id)}: ${escape(node.label)}`);
  for (const edge of ir.edges) {
    const label = edge.label ? `: ${escape(edge.label)}` : "";
    lines.push(`  ${safeId(edge.from)} --> ${safeId(edge.to)}${label}`);
  }
  return lines.join("\n");
}

/**
 * Mermaid treats some identifiers as syntax (`end` closes a subgraph or
 * composite state and breaks the parse outright), and the IR's id charset —
 * whether from the model or the offline fallback — doesn't exclude them.
 * Suffix the reserved ones so every IR serializes to parseable Mermaid.
 */
const RESERVED_IDS = new Set([
  "end",
  "subgraph",
  "direction",
  "style",
  "linkstyle",
  "classdef",
  "class",
  "click",
  "default",
  "graph",
  "flowchart",
  "state",
  "note",
]);

const safeId = (id: string): string => (RESERVED_IDS.has(id.toLowerCase()) ? `${id}_` : id);

/** Map a node kind to Mermaid node shape syntax. */
function shape(node: IrNode): string {
  const text = escape(node.label);
  switch (node.kind) {
    case "start":
    case "end":
      return `([${text}])`;
    case "decision":
      return `{${text}}`;
    case "constraint":
      return `[/${text}/]`;
    default:
      return `[${text}]`;
  }
}

const escape = (text: string): string => text.replace(/"/g, "&quot;").replace(/\n/g, " ");
