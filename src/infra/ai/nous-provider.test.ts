import { describe, expect, it } from "vitest";
import { createNousProvider } from "./nous-provider";

describe("createNousProvider", () => {
  it("returns a null model when no Nous key is configured", () => {
    const provider = createNousProvider({
      apiKey: undefined,
      modelIds: modelIds("Hermes-4.3-36B"),
      structuredOutputs: "json",
    });

    expect(provider.model).toBeNull();
  });

  it("disables strict structured outputs for JSON mode", () => {
    const provider = createNousProvider({
      apiKey: "nous-key",
      modelIds: modelIds("Hermes-4.3-36B"),
      baseUrl: "https://example.test/v1",
      structuredOutputs: "json",
    });

    expect(provider.model).not.toBeNull();
    expect(provider.model).toMatchObject({ supportsStructuredOutputs: false });
  });

  it("preserves strict structured outputs for JSON-schema mode", () => {
    const provider = createNousProvider({
      apiKey: "nous-key",
      modelIds: modelIds("Hermes-4.3-36B"),
      structuredOutputs: "json-schema",
    });

    expect(provider.model).toMatchObject({ supportsStructuredOutputs: true });
  });
});

function modelIds(model: string) {
  return {
    default: model,
    classify: model,
    generate: model,
    runAgent: model,
    streamAgent: model,
  };
}
