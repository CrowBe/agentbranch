import type { ModelProvider } from "@/modules/model-gateway";

/**
 * Offline model provider — no model. The gateway sees `model: null`, so every
 * primitive (and the build loop above it) fails `model_unavailable`. Lets the
 * whole shell run and the route handler be exercised before any key exists.
 */
export const stubModelProvider: ModelProvider = { model: null };
