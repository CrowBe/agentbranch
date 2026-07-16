import { describe, expect, it } from "vitest";
import { createNousProvider } from "./nous-provider";

describe("createNousProvider", () => {
  it("returns a null model when no Nous key is configured", () => {
    const provider = createNousProvider({
      apiKey: undefined,
      modelIds: modelIds("Hermes-4.3-36B"),
    });

    expect(provider.model).toBeNull();
  });

  it("creates an AI SDK language model when configured", () => {
    const provider = createNousProvider({
      apiKey: "nous-key",
      modelIds: modelIds("Hermes-4.3-36B"),
      baseUrl: "https://example.test/v1",
    });

    expect(provider.model).not.toBeNull();
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
