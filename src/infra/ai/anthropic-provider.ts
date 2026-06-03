import { createAnthropic } from "@ai-sdk/anthropic";
import type { ModelProvider } from "@/modules/model-gateway";

/**
 * The real model provider: Claude via the Vercel AI SDK's Anthropic provider
 * (NOT the Anthropic SDK directly — the platform stays provider-swappable,
 * ARCHITECTURE §4). The server owns the key; it never reaches the client. Only
 * the model gateway consumes this provider.
 *
 * Returns a null-model provider when unconfigured so the gateway degrades to a
 * clear `model_unavailable` instead of throwing at construction.
 */
export function createAnthropicProvider(params: {
  apiKey: string | undefined;
  modelId: string;
}): ModelProvider {
  if (!params.apiKey) return { model: null };
  const anthropic = createAnthropic({ apiKey: params.apiKey });
  return { model: anthropic(params.modelId) };
}
