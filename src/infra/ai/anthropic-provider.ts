import { createAnthropic } from "@ai-sdk/anthropic";
import type { ModelProvider } from "@/modules/build-loop";

/**
 * The real model provider: Claude via the Vercel AI SDK's Anthropic provider
 * (NOT the Anthropic SDK directly — the build loop stays provider-swappable,
 * ARCHITECTURE §4). The server owns the key; it never reaches the client.
 *
 * Returns a null-model provider when unconfigured so the build loop degrades to
 * a clear error instead of throwing at construction.
 */
export function createAnthropicProvider(params: {
  apiKey: string | undefined;
  modelId: string;
}): ModelProvider {
  if (!params.apiKey) return { model: null };
  const anthropic = createAnthropic({ apiKey: params.apiKey });
  return { model: anthropic(params.modelId) };
}
