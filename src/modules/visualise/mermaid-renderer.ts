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
    const lines = ["flowchart TD"];
    for (const node of ir.nodes) lines.push(`  ${node.id}${shape(node)}`);
    for (const edge of ir.edges) {
      const label = edge.label ? `|${escape(edge.label)}|` : "";
      lines.push(`  ${edge.from} -->${label} ${edge.to}`);
    }
    return { mermaid: lines.join("\n") };
  },
};

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
