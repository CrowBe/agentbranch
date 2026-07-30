import type { HarnessVersionId } from "@/shared";

/**
 * The versioned pieces of the validation harness. Every artifact that can
 * change a graded outcome belongs here: if two harnesses can score the same
 * skill differently, they must not be able to report the same version, or the
 * improvement loop's "vN+1 beat vN on identical ground" claim is unfounded
 * (ARCHITECTURE §9).
 *
 * Frozen *sets* are deliberately absent — the regression benchmark pins its
 * corpora by set hash on each run, so they are attributable there, not here.
 */
export type HarnessArtifactHashes = {
  readonly buildLoopSystemPrompt: string;
  readonly lintRuleset: string;
  readonly promptBatteryGenerator: string;
  readonly testRunWorldGenerator: string;
  readonly distractorLibrary: string;
  readonly responseSchemaLintRuleset: string;
  readonly toolContractLintRuleset: string;
  readonly subagentDefinitionLintRuleset: string;
  /** The three equipment authoring prompts, hashed together. */
  readonly equipmentAuthoringPrompts: string;
  readonly safetyReviewJudge: string;
  readonly adversarialNegativeBattery: string;
};

export type HarnessManifest = HarnessArtifactHashes & {
  readonly gitSha: string | null;
};

export type HarnessVersion = HarnessManifest & {
  readonly id: HarnessVersionId;
  readonly manifestHash: string;
  readonly createdAt: Date;
};
