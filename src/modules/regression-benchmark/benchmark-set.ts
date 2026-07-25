import { createHash } from "node:crypto";
import { canonicalJson } from "@/shared";
import { baselineSkillCorpus } from "@/modules/baseline-corpus";
import { adversarialSafetyBattery } from "@/modules/adversarial-safety-battery";
import { responseSchemaCorpus } from "@/modules/response-schema-corpus";
import { toolContractCorpus } from "@/modules/tool-contract-corpus";
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
export const regressionBenchmarkSet: readonly BenchmarkEntry[] =
  baselineSkillCorpus.map((entry) => ({
    corpusEntryId: entry.id,
    name: entry.name,
    description: entry.description,
    contentHash: entry.contentHash,
    battery: entry.promptBattery.map((c) => ({
      grader: "selection",
      prompt: c.prompt,
      expected: c.expected,
    })),
  }));

/** Identity of the frozen set — changes iff a corpus skill or battery changes. */
export const regressionBenchmarkSetHash: string = createHash("sha256")
  .update(
    regressionBenchmarkSet
      .map(
        (entry) =>
          `${entry.corpusEntryId}:${entry.contentHash}:${entry.battery
            .map(canonicalBenchmarkCase)
            .join("\n")}`,
      )
      .join("\n\n"),
  )
  .digest("hex");

/**
 * Selection retains the original byte-for-byte `expected|prompt` identity.
 * New graders use an explicitly versioned canonical JSON tuple.
 */
export function canonicalBenchmarkCase(c: PromptCase): string {
  switch (c.grader) {
    case "selection":
      return `${c.expected}|${c.prompt}`;
    case "json-output":
      return JSON.stringify([
        "benchmark-case",
        1,
        "json-output",
        c.graderVersion,
        c.prompt,
        canonicalJson(c.expectedSchema),
      ]);
  }
}


export const responseSchemaBenchmarkSet = responseSchemaCorpus;
export const toolContractBenchmarkSet = toolContractCorpus;
export const safetyBenchmarkSet = adversarialSafetyBattery;

export const responseSchemaBenchmarkSetHash = hashCorpusSet(
  responseSchemaBenchmarkSet,
);
export const toolContractBenchmarkSetHash = hashCorpusSet(
  toolContractBenchmarkSet,
);
export const safetyBenchmarkSetHash = hashCorpusSet(safetyBenchmarkSet);

function hashCorpusSet(
  set: readonly { readonly id: string; readonly contentHash: string }[],
): string {
  return createHash("sha256")
    .update(set.map((entry) => `${entry.id}:${entry.contentHash}`).join("\n"))
    .digest("hex");
}
