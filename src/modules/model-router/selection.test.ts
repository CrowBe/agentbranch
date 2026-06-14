import { describe, expect, it } from "vitest";
import { isErr, isOk } from "@/shared";
import {
  defaultSelection,
  effectiveModelIds,
  findProfile,
  validateSelection,
} from "./selection";
import type { ProviderProfile } from "./router.types";

const anthropic: ProviderProfile = {
  id: "anthropic",
  label: "Anthropic (Claude)",
  kind: "anthropic",
  modelIds: {
    default: "claude-opus-4-8",
    classify: "claude-haiku-4-5",
    generate: "claude-sonnet-4-6",
    runAgent: "claude-opus-4-8",
    streamAgent: "claude-opus-4-8",
  },
};
const nous: ProviderProfile = {
  id: "nous",
  label: "Nous Portal",
  kind: "openai-compatible",
  baseUrl: "https://example.test/v1",
  modelIds: {
    default: "Hermes-4.3-36B",
    classify: "Hermes-4.3-36B",
    generate: "Hermes-4.3-36B",
    runAgent: "Hermes-4.3-36B",
    streamAgent: "Hermes-4.3-36B",
  },
};
const registry = [anthropic, nous];

describe("findProfile", () => {
  it("looks a provider up by id", () => {
    expect(findProfile(registry, "nous")).toBe(nous);
    expect(findProfile(registry, "missing")).toBeUndefined();
  });
});

describe("defaultSelection", () => {
  it("prefers the requested provider when registered", () => {
    expect(defaultSelection(registry, "nous")).toEqual({ providerId: "nous" });
  });

  it("falls back to the first registered provider", () => {
    expect(defaultSelection(registry, "missing")).toEqual({ providerId: "anthropic" });
    expect(defaultSelection(registry)).toEqual({ providerId: "anthropic" });
  });
});

describe("validateSelection", () => {
  it("accepts a known provider", () => {
    const result = validateSelection({ providerId: "anthropic" }, registry);
    expect(isOk(result)).toBe(true);
  });

  it("rejects an unknown provider as not_found", () => {
    const result = validateSelection({ providerId: "bogus" }, registry);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.tag).toBe("not_found");
  });

  it("rejects an empty model-id override", () => {
    const result = validateSelection(
      { providerId: "anthropic", modelIds: { classify: "  " } },
      registry,
    );
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.tag).toBe("not_configured");
  });
});

describe("effectiveModelIds", () => {
  it("uses the profile defaults with no overrides", () => {
    expect(effectiveModelIds(anthropic, { providerId: "anthropic" })).toEqual(anthropic.modelIds);
  });

  it("lets an active per-primitive override win over the profile", () => {
    const ids = effectiveModelIds(anthropic, {
      providerId: "anthropic",
      modelIds: { generate: "claude-sonnet-pinned" },
    });
    expect(ids.generate).toBe("claude-sonnet-pinned");
    expect(ids.classify).toBe(anthropic.modelIds.classify);
  });

  it("falls back to a bring-your-own override before the profile", () => {
    const ids = effectiveModelIds(nous, { providerId: "nous" }, { modelIds: { default: "Hermes-byo" } });
    expect(ids.default).toBe("Hermes-byo");
  });

  it("ignores a selection aimed at a different provider", () => {
    const ids = effectiveModelIds(anthropic, { providerId: "nous", modelIds: { default: "x" } });
    expect(ids).toEqual(anthropic.modelIds);
  });
});
