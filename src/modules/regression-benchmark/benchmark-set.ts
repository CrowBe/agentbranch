import { createHash } from "node:crypto";
import { baselineSkillCorpus } from "@/modules/baseline-corpus";
import type { PromptCase } from "@/modules/triggering-eval";

/** One skill in the frozen set: identity + the battery it is always scored on. */
export type BenchmarkEntry = {
  readonly corpusEntryId: string;
  readonly name: string;
  readonly description: string;
  readonly contentHash: string;
  readonly battery: readonly PromptCase[];
};

/**
 * The frozen benchmark set (ARCHITECTURE §9, #123): the baseline skill corpus
 * with its curated prompt batteries. Holding the set fixed while the harness
 * varies is what makes scores across harness versions comparable — the set
 * hash below pins exactly what "fixed" means.
 */
export const regressionBenchmarkSet: readonly BenchmarkEntry[] = baselineSkillCorpus.map(
  (entry) => ({
    corpusEntryId: entry.id,
    name: entry.name,
    description: entry.description,
    contentHash: entry.contentHash,
    battery: entry.promptBattery.map((c) => ({ prompt: c.prompt, expected: c.expected })),
  }),
);

/** Identity of the frozen set — changes iff a corpus skill or battery changes. */
export const regressionBenchmarkSetHash: string = createHash("sha256")
  .update(
    regressionBenchmarkSet
      .map(
        (entry) =>
          `${entry.corpusEntryId}:${entry.contentHash}:${entry.battery
            .map((c) => `${c.expected}|${c.prompt}`)
            .join("\n")}`,
      )
      .join("\n\n"),
  )
  .digest("hex");
