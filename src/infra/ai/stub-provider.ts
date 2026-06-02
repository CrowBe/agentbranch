import type { ModelProvider } from "@/modules/build-loop";

/**
 * Offline model provider — no model. The build loop sees `model: null` and
 * yields a single, friendly "not configured" event. Lets the whole shell run
 * and the route handler be exercised before any key exists.
 */
export const stubModelProvider: ModelProvider = { model: null };
