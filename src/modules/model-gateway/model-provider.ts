import type { LanguageModel } from "ai";

export type ModelGatewayPrimitive = "classify" | "runAgent" | "streamAgent" | "generate";

/**
 * Model-provider port — the raw language model the gateway plumbs to. Infra
 * supplies an Anthropic-backed provider (default: Claude) or a null-model stub
 * for offline/test. This is the seam that keeps the platform "provider-swappable
 * later" (ARCHITECTURE §4); only the **model gateway** consumes it — nothing
 * above the gateway touches the raw model.
 */
export interface ModelProvider {
  /** The configured language model, or null when no key is present. */
  readonly model: LanguageModel | null;
  /** Optional per-primitive routes. Missing routes fall back to `model`. */
  readonly models?: Partial<Record<ModelGatewayPrimitive, LanguageModel | null>>;
}
