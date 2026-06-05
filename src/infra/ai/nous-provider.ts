import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { ModelProvider } from "@/modules/model-gateway";
import { DEFAULT_NOUS_BASE_URL } from "@/server/config";

/**
 * Nous Portal provider. Nous exposes an OpenAI-compatible chat/completions API,
 * so this stays on the AI SDK provider seam rather than adding bespoke HTTP.
 */
export function createNousProvider(params: {
  apiKey: string | undefined;
  modelId: string;
  baseUrl?: string;
}): ModelProvider {
  if (!params.apiKey) return { model: null };
  const nous = createOpenAICompatible({
    name: "nous",
    apiKey: params.apiKey,
    baseURL: params.baseUrl ?? DEFAULT_NOUS_BASE_URL,
    includeUsage: true,
  });
  return { model: nous(params.modelId) };
}
