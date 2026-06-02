import type { LanguageModel } from "ai";

/**
 * Model-provider port. The build loop orchestrates the Vercel AI SDK but does
 * not know *which* model backs it — infra supplies an Anthropic-backed provider
 * (default: Claude) or a deterministic stub for offline/test. This is the seam
 * that keeps the loop "provider-swappable later" (ARCHITECTURE §4).
 */
export interface ModelProvider {
  /** The configured language model, or null when no key is present. */
  readonly model: LanguageModel | null;
}
