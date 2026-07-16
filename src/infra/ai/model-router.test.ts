import { describe, expect, it } from "vitest";
import { isErr, isOk } from "@/shared";
import { createModelRouter, type ServerKey } from "./model-router";
import type { ProviderId, ProviderProfile } from "@/modules/model-router";

const profiles: ProviderProfile[] = [
  {
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
  },
  {
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
  },
];

function router(serverKeys: Partial<Record<ProviderId, ServerKey>> = {}) {
  return createModelRouter({
    profiles,
    serverKeys,
    defaultSelection: { providerId: "anthropic" },
  });
}

describe("createModelRouter — resolution", () => {
  it("fails model_unavailable when the active provider has no key", () => {
    const r = router();
    expect(r.hasModel()).toBe(false);
    const resolved = r.resolve("classify");
    expect(isErr(resolved)).toBe(true);
    if (isErr(resolved)) expect(resolved.error.tag).toBe("model_unavailable");
  });

  it("resolves the active provider's per-primitive model from the server pool", () => {
    const r = router({ anthropic: { apiKey: "sk-server" } });
    expect(r.hasModel()).toBe(true);
    const resolved = r.resolve("classify");
    expect(isOk(resolved)).toBe(true);
    if (isOk(resolved)) {
      expect(resolved.value.providerId).toBe("anthropic");
      expect(resolved.value.kind).toBe("anthropic");
      expect(resolved.value.structuredOutputs).toBe("json-schema");
      expect(resolved.value.modelId).toBe("claude-haiku-4-5");
      expect(resolved.value.viaOverride).toBe(false);
    }
  });
});

describe("createModelRouter — selection", () => {
  it("switches the active provider and resolves the new one's model", () => {
    const r = router({
      anthropic: { apiKey: "sk-a" },
      nous: { apiKey: "sk-n" },
    });

    const applied = r.setActive({ providerId: "nous" });
    expect(isOk(applied)).toBe(true);

    const resolved = r.resolve("runAgent");
    expect(isOk(resolved)).toBe(true);
    if (isOk(resolved)) {
      expect(resolved.value.providerId).toBe("nous");
      expect(resolved.value.modelId).toBe("Hermes-4.3-36B");
    }
  });

  it("honours a per-primitive model override in the selection", () => {
    const r = router({ anthropic: { apiKey: "sk-a" } });
    r.setActive({
      providerId: "anthropic",
      modelIds: { generate: "claude-sonnet-pinned" },
    });
    const resolved = r.resolve("generate");
    if (isOk(resolved)) expect(resolved.value.modelId).toBe("claude-sonnet-pinned");
  });

  it("rejects an unknown provider as not_found", () => {
    const applied = router().setActive({ providerId: "bogus" });
    expect(isErr(applied)).toBe(true);
    if (isErr(applied)) expect(applied.error.tag).toBe("not_found");
  });
});

describe("createModelRouter — bring-your-own credentials", () => {
  it("resolves via a bring-your-own key when the server pool has none", () => {
    const r = router();
    const stored = r.setCredential({
      providerId: "anthropic",
      apiKey: "sk-byo",
    });
    expect(isOk(stored)).toBe(true);
    expect(r.hasModel()).toBe(true);

    const resolved = r.resolve("classify");
    expect(isOk(resolved)).toBe(true);
    if (isOk(resolved)) expect(resolved.value.viaOverride).toBe(true);
  });

  it("rejects an empty bring-your-own key", () => {
    const stored = router().setCredential({
      providerId: "anthropic",
      apiKey: "  ",
    });
    expect(isErr(stored)).toBe(true);
    if (isErr(stored)) expect(stored.error.tag).toBe("not_configured");
  });

  it("falls back to the server pool after clearing the override", () => {
    const r = router({ anthropic: { apiKey: "sk-server" } });
    r.setCredential({ providerId: "anthropic", apiKey: "sk-byo" });
    r.clearCredential("anthropic");
    const resolved = r.resolve("classify");
    if (isOk(resolved)) expect(resolved.value.viaOverride).toBe(false);
  });
});

describe("createModelRouter — snapshot is secret-free", () => {
  it("reports key presence as booleans and never leaks the key", () => {
    const r = router({ anthropic: { apiKey: "sk-server" } });
    r.setCredential({ providerId: "nous", apiKey: "sk-byo-secret" });
    const snapshot = r.snapshot();

    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain("sk-server");
    expect(serialized).not.toContain("sk-byo-secret");

    const anthropic = snapshot.providers.find((p) => p.id === "anthropic");
    const nous = snapshot.providers.find((p) => p.id === "nous");
    expect(anthropic).toMatchObject({
      hasServerKey: true,
      hasByoKey: false,
      ready: true,
    });
    expect(anthropic?.structuredOutputs).toBe("json-schema");
    expect(nous).toMatchObject({
      hasServerKey: false,
      hasByoKey: true,
      ready: true,
      structuredOutputs: "json",
    });
    expect(snapshot.active).toEqual({ providerId: "anthropic" });
  });

  it("rebuilds a provider when its structured-output mode changes", () => {
    const mutableProfile = {
      ...profiles[1]!,
      structuredOutputs: "json" as "json" | "json-schema",
    };
    const r = createModelRouter({
      profiles: [mutableProfile],
      serverKeys: { nous: { apiKey: "sk-n" } },
    });
    const first = r.resolve("classify");
    mutableProfile.structuredOutputs = "json-schema";
    const second = r.resolve("classify");

    expect(isOk(first)).toBe(true);
    expect(isOk(second)).toBe(true);
    if (isOk(first) && isOk(second)) expect(second.value.model).not.toBe(first.value.model);
  });
});
