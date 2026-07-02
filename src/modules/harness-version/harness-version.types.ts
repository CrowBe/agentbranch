import type { HarnessVersionId } from "@/shared";

export type HarnessArtifactHashes = {
  readonly buildLoopSystemPrompt: string;
  readonly lintRuleset: string;
  readonly promptBatteryGenerator: string;
  readonly testRunWorldGenerator: string;
  readonly distractorLibrary: string;
};

export type HarnessManifest = HarnessArtifactHashes & {
  readonly gitSha: string | null;
};

export type HarnessVersion = HarnessManifest & {
  readonly id: HarnessVersionId;
  readonly manifestHash: string;
  readonly createdAt: Date;
};
