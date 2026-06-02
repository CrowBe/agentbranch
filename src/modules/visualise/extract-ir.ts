import { type Skill } from "@/modules/skill";
import type { Analyzer } from "@/modules/skill-analysis";
import { ok } from "@/shared";
import type { SkillIR, IrNode, IrEdge } from "./ir.types";

/**
 * Read a skill → emit the skill IR.
 *
 * STUB: v1 ships a model-emitted IR (the model picks the diagram type and the
 * node/edge graph — ARCHITECTURE §4). Until the build loop feeds that in, this
 * derives a deterministic linear flowchart from the body's headings so the
 * Mermaid renderer and the whole seam are exercisable offline. The *shape* of
 * what's returned (nodes + edges + spans) is the real, stable contract.
 */
export const irAnalyzer: Analyzer<SkillIR> = {
  kind: "skill-ir",
  async analyze(skill: Skill) {
    const headings = extractHeadings(skill.source.body);
    const nodes: IrNode[] = [
      { id: "start", label: "Triggered", kind: "start", span: { start: 0, end: 0 } },
      ...headings.map((h, i): IrNode => ({
        id: `n${i}`,
        label: h.text,
        kind: /never|don't|do not|must not/i.test(h.text) ? "constraint" : "step",
        span: h.span,
      })),
      { id: "end", label: "Done", kind: "end", span: { start: 0, end: 0 } },
    ];

    const ids = nodes.map((n) => n.id);
    const edges: IrEdge[] = ids
      .slice(0, -1)
      .map((from, i): IrEdge => ({ from, to: ids[i + 1]! }));

    return ok({ kind: "skill-ir" as const, diagram: "flowchart" as const, nodes, edges });
  },
};

function extractHeadings(
  body: string,
): { text: string; span: { start: number; end: number } }[] {
  const out: { text: string; span: { start: number; end: number } }[] = [];
  let offset = 0;
  for (const line of body.split("\n")) {
    const match = /^#{1,6}\s+(.*)$/.exec(line);
    if (match) {
      out.push({ text: match[1]!.trim(), span: { start: offset, end: offset + line.length } });
    }
    offset += line.length + 1;
  }
  return out;
}
