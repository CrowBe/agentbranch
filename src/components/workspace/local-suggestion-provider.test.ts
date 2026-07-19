import { describe, expect, it, vi } from "vitest";
import {
  createDeterministicLocalSuggestionProvider,
  createPromptApiLocalSuggestionProvider,
  suggestLocallyOrRoute,
  truncateLocalSuggestionSource,
  type LocalSuggestionRequest,
  type PromptApi,
} from "./local-suggestion-provider";

const request: LocalSuggestionRequest = {
  instruction: "Suggest editable metadata. Return JSON.",
  source: "---\nname: inbox-triage\n---\nSort mail.",
  responseSchema: { type: "object", properties: { category: { type: "string" } }, required: ["category"] },
};

const decode = (value: unknown) => {
  if (typeof value !== "object" || value === null || !("category" in value)) return null;
  const category = (value as { category?: unknown }).category;
  return typeof category === "string" ? { category } : null;
};

describe("local suggestion provider", () => {
  it("uses structured Prompt API output only when the model is already available", async () => {
    const destroy = vi.fn();
    const prompt = vi.fn().mockResolvedValue('{"category":"productivity"}');
    const api: PromptApi = {
      availability: vi.fn().mockResolvedValue("available"),
      create: vi.fn().mockResolvedValue({ prompt, destroy }),
    };
    const route = vi.fn().mockResolvedValue({ category: "other" });
    const result = await suggestLocallyOrRoute({
      provider: createPromptApiLocalSuggestionProvider(api), request, decode, route,
    });

    expect(result).toEqual({ value: { category: "productivity" }, provenance: "on-device" });
    expect(prompt).toHaveBeenCalledWith(expect.stringContaining("<skill>"), {
      responseConstraint: request.responseSchema,
      omitResponseConstraintInput: true,
    });
    expect(route).not.toHaveBeenCalled();
    expect(destroy).toHaveBeenCalledOnce();
  });

  it.each(["downloadable", "downloading", "unavailable"])(
    "falls through without creating a session when availability is %s",
    async (state) => {
      const api: PromptApi = { availability: vi.fn().mockResolvedValue(state), create: vi.fn() };
      const result = await suggestLocallyOrRoute({
        provider: createPromptApiLocalSuggestionProvider(api), request, decode,
        route: vi.fn().mockResolvedValue({ category: "other" }),
      });
      expect(result).toEqual({ value: { category: "other" }, provenance: "route" });
      expect(api.create).not.toHaveBeenCalled();
    },
  );

  it("silently falls through on malformed local output", async () => {
    const route = vi.fn().mockResolvedValue({ category: "other" });
    const result = await suggestLocallyOrRoute({
      provider: createDeterministicLocalSuggestionProvider({ wrong: true }), request, decode, route,
    });
    expect(result).toEqual({ value: { category: "other" }, provenance: "route" });
    expect(route).toHaveBeenCalledOnce();
  });

  it("truncates long skill sources at the provider boundary", () => {
    expect(truncateLocalSuggestionSource("123456789", 5)).toBe("12345\n\n[Skill source truncated]");
  });
});
