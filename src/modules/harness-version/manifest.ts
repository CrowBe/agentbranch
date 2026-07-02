import { createHash } from "node:crypto";
import { BUILD_LOOP_SYSTEM_PROMPT } from "@/modules/build-loop";
import { LINT_RULESET_VERSION } from "@/modules/lint";
import {
  PROMPT_BATTERY_GENERATOR_VERSION,
  distractorLibrary,
} from "@/modules/triggering-eval";
import { TEST_RUN_WORLD_GENERATOR_VERSION } from "@/modules/test-run";
import type { HarnessManifest } from "./harness-version.types";

export function currentHarnessManifest(): HarnessManifest {
  return {
    buildLoopSystemPrompt: hashStable(BUILD_LOOP_SYSTEM_PROMPT),
    lintRuleset: hashStable(LINT_RULESET_VERSION),
    promptBatteryGenerator: hashStable(PROMPT_BATTERY_GENERATOR_VERSION),
    testRunWorldGenerator: hashStable(TEST_RUN_WORLD_GENERATOR_VERSION),
    distractorLibrary: hashStable(distractorLibrary),
    gitSha: currentGitSha(),
  };
}

export function hashHarnessManifest(manifest: HarnessManifest): string {
  return hashStable(manifest);
}

function hashStable(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function currentGitSha(): string | null {
  return (
    process.env.VERCEL_GIT_COMMIT_SHA ??
    process.env.GITHUB_SHA ??
    process.env.AGENTBRANCH_GIT_SHA ??
    null
  );
}
