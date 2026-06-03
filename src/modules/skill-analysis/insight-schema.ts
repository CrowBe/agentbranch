import { z } from "zod";

/**
 * The Zod schema for an `Insight` — the structured-output contract an evaluator
 * hands to `gateway.generate` to produce its interpretation. Lives next to the
 * `Insight` type so the shape has one source of truth across every evaluation
 * kind. `z.infer<typeof insightSchema>` is structurally the `Insight` type.
 */
export const insightSchema = z.object({
  verdict: z
    .enum(["good", "needs-attention", "failing"])
    .describe("Overall judgement, driving the headline tone."),
  summary: z.string().describe("1–2 plain-language sentences the user reads first."),
  findings: z.array(z.string()).describe("What's working well."),
  watch: z.array(z.string()).describe("Things to look at or act on."),
});
