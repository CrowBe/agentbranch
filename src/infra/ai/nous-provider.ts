import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { ModelProvider } from "@/modules/model-gateway";
import { DEFAULT_NOUS_BASE_URL } from "@/server/config";

/**
 * Nous Portal provider. Nous exposes an OpenAI-compatible chat/completions API,
 * so this stays on the AI SDK provider seam rather than adding bespoke HTTP.
 */
export function createNousProvider(params: {
  apiKey: string | undefined;
  modelIds: {
    readonly default: string;
    readonly classify: string;
    readonly generate: string;
    readonly runAgent: string;
    readonly streamAgent: string;
  };
  baseUrl?: string;
}): ModelProvider {
  if (!params.apiKey) return { model: null };
  const nous = createOpenAICompatible({
    name: "nous",
    apiKey: params.apiKey,
    baseURL: params.baseUrl ?? DEFAULT_NOUS_BASE_URL,
    includeUsage: true,
    supportsStructuredOutputs: true,
  });
  const fallback = nous(params.modelIds.default);
  return {
    model: fallback,
    models: {
      classify: nous(params.modelIds.classify),
      generate: nous(params.modelIds.generate),
      runAgent: nous(params.modelIds.runAgent),
      streamAgent: nous(params.modelIds.streamAgent),
    },
  };
}
