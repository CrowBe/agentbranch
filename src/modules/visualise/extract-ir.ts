import { z } from "zod";
import { type Skill } from "@/modules/skill";
import type { AnalysisContext, Analyzer } from "@/modules/skill-analysis";
import { isErr, ok } from "@/shared";
import type { SkillIR, IrNode, IrEdge } from "./ir.types";

/**
 * Read a skill → emit the skill IR.
 *
 * Visualise stays an analysis capability: it emits a static artifact and can run
 * offline. When the caller supplies a gateway + accounting tag, the model emits
 * the richer IR; otherwise the deterministic fallback keeps the seam usable.
 */
export const irAnalyzer: Analyzer<Skill, SkillIR> = {
  kind: "skill-ir",
  async analyze(skill: Skill, context?: AnalysisContext) {
    const gateway = context?.gateway;
    if (gateway?.hasModel && context?.tag) {
      const generated = await gateway.generate({
        system:
          "You extract a visual intermediate representation for Agent Skills. Return only graph data grounded in the supplied SKILL.md source.",
        prompt: modelPrompt(skill),
        schema: skillIrSchema,
        tag: context.tag,
      });
      if (!isErr(generated) && spansAreWithinSource(generated.value, skill.source.body.length)) {
        return ok(generated.value);
      }
    }

    return ok(fallbackIr(skill));
  },
};

function fallbackIr(skill: Skill): SkillIR {
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

  return { kind: "skill-ir", diagram: "flowchart", nodes, edges };
}

function spansAreWithinSource(ir: SkillIR, sourceLength: number): boolean {
  return ir.nodes.every((node) => node.span.end <= sourceLength);
}

const sourceSpanSchema = z
  .object({
    start: z.number().int().min(0),
    end: z.number().int().min(0),
  })
  .refine((span) => span.end >= span.start, "span end must be >= start");

const irNodeSchema = z.object({
  id: z.string().min(1).regex(/^[A-Za-z][A-Za-z0-9_-]*$/),
  label: z.string().min(1).max(80),
  kind: z.enum(["start", "step", "decision", "constraint", "end"]),
  span: sourceSpanSchema,
});

const edgeSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  label: z.string().min(1).max(60).optional(),
});

const skillIrSchema: z.ZodType<SkillIR> = z
  .object({
    kind: z.literal("skill-ir"),
    diagram: z.enum(["flowchart", "sequence", "stateDiagram"]),
    nodes: z.array(irNodeSchema).min(2).max(16),
    edges: z.array(edgeSchema).max(24),
  })
  .superRefine((ir, ctx) => {
    const ids = new Set(ir.nodes.map((node) => node.id));
    for (const edge of ir.edges) {
      if (ids.has(edge.from) && ids.has(edge.to)) continue;
      ctx.addIssue({
        code: "custom",
        message: `edge ${edge.from}->${edge.to} references a missing node`,
        path: ["edges", ir.edges.indexOf(edge)],
      });
    }
  });

function modelPrompt(skill: Skill): string {
  const body = skill.source.body;
  return `Create a concise SkillIR for this SKILL.md.

Rules:
- Choose diagram: flowchart, sequence, or stateDiagram.
- Include start/end nodes when useful.
- Prefer branching/decision nodes over a simple heading list when the skill logic branches.
- Every node span must be a character range inside the body text below.
- Edges must reference node ids exactly.
- Keep labels short and user-facing.

Body length: ${body.length}

SKILL.md body:
${body}`;
}

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
