import { afterEach, describe, expect, it, vi } from "vitest";
import type { ResolvedModel } from "@/modules/model-router";
import { isErr } from "@/shared";
import { createLazyCodexModelCalls } from "./lazy-codex-model-calls";

const model: ResolvedModel = {
  providerId: "codex-cli",
  kind: "codex-cli",
  structuredOutputs: "json-schema",
  modelId: "cli:codex",
  viaOverride: false,
};

afterEach(() => vi.unstubAllEnvs());

describe("lazy Codex model calls", () => {
  it("does not load the filesystem runner in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const calls = createLazyCodexModelCalls();

    const result = await calls.classify(model, {
      choices: ["yes"],
      prompt: "yes",
    });

    expect(isErr(result) && result.error.tag).toBe("model_unavailable");
    expect(isErr(result) && result.error.message).toContain("only in development");
  });
});
