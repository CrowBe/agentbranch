import type { ModelGateway } from "@/modules/model-gateway";
import { err, domainError } from "@/shared";

/**
 * Offline model gateway — no model. `hasModel` is false, so the seam's
 * `runEvaluation` short-circuits to `model_unavailable` before an evaluator
 * runs. The primitives also fail the same way if called directly, so the whole
 * shell runs offline before any Anthropic key exists (ARCHITECTURE §4 stack).
 */
export const stubModelGateway: ModelGateway = {
  hasModel: false,
  async classify() {
    return err(domainError("model_unavailable", "No model is configured."));
  },
  async runAgent() {
    return err(domainError("model_unavailable", "No model is configured."));
  },
};
