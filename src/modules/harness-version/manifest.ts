import { createHash } from "node:crypto";
import {
  BUILD_LOOP_SYSTEM_PROMPT,
  RESPONSE_SCHEMA_AUTHORING_PROMPT,
  SUBAGENT_DEFINITION_AUTHORING_PROMPT,
  TOOL_CONTRACT_AUTHORING_PROMPT,
} from "@/modules/build-loop";
import { LINT_RULESET_VERSION } from "@/modules/lint";
import {
  PROMPT_BATTERY_GENERATOR_VERSION,
  distractorLibrary,
} from "@/modules/triggering-eval";
import { TEST_RUN_WORLD_GENERATOR_VERSION } from "@/modules/test-run";
import { RESPONSE_SCHEMA_LINT_RULESET_VERSION } from "@/modules/response-schema";
import { TOOL_CONTRACT_LINT_RULESET_VERSION } from "@/modules/tool-contract";
import { SUBAGENT_DEFINITION_LINT_RULESET_VERSION } from "@/modules/subagent-definition";
import { safetyReviewPrompts } from "@/modules/safety-review";
import { adversarialTriggeringNegativePrompts } from "@/modules/adversarial-safety-battery";
import type { HarnessManifest } from "./harness-version.types";

export function currentHarnessManifest(): HarnessManifest {
  return {
    buildLoopSystemPrompt: hashStable(BUILD_LOOP_SYSTEM_PROMPT),
    lintRuleset: hashStable(LINT_RULESET_VERSION),
    promptBatteryGenerator: hashStable(PROMPT_BATTERY_GENERATOR_VERSION),
    testRunWorldGenerator: hashStable(TEST_RUN_WORLD_GENERATOR_VERSION),
    distractorLibrary: hashStable(distractorLibrary),
    responseSchemaLintRuleset: hashStable(RESPONSE_SCHEMA_LINT_RULESET_VERSION),
    toolContractLintRuleset: hashStable(TOOL_CONTRACT_LINT_RULESET_VERSION),
    subagentDefinitionLintRuleset: hashStable(SUBAGENT_DEFINITION_LINT_RULESET_VERSION),
    equipmentAuthoringPrompts: hashStable([
      RESPONSE_SCHEMA_AUTHORING_PROMPT,
      TOOL_CONTRACT_AUTHORING_PROMPT,
      SUBAGENT_DEFINITION_AUTHORING_PROMPT,
    ]),
    safetyReviewJudge: hashStable(safetyReviewPrompts()),
    adversarialNegativeBattery: hashStable(adversarialTriggeringNegativePrompts),
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
