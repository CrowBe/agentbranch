/**
 * model-gateway — the platform's single, controlled entry to the model
 * (CONTEXT.md → Model gateway; ARCHITECTURE §3, §4).
 *
 * Pure *mechanism*: exposes the fine intent-level primitives `classify` /
 * `runAgent` / `streamAgent` / `generate`. Callers compose their own *method*
 * on top — the gateway knows no evaluation kinds. Every call carries an
 * `AccountingTag` (`account` | `platform`); the gateway routes accounting
 * through the **usage** authority. The seam's evaluators and the build loop
 * depend on this port.
 *
 * The implementation is split at the **raw model-calls port** (#160): the
 * accounting shell (`createModelGateway`, here) owns admission + recording and
 * resolves the model through the **model router**; the `RawModelCalls` adapter
 * (`infra/ai/sdk-model-calls.ts`, wired in `container.ts`) owns SDK
 * translation only — so policy holds for every adapter by construction.
 *
 * Consumers: the build loop and evaluation (now); the portability transform and
 * mock-data generation (later) — all reuse the same port.
 */
export type {
  AccountingTag,
  GatewayCacheControl,
  GatewayMessage,
  GatewaySystemPrompt,
  GatewayTool,
  AgentStep,
  AgentStreamPart,
  Classification,
  AgentTurn,
  StreamAgentInput,
  GenerateInput,
  ModelGateway,
} from "./gateway.types";
export type { ModelProvider, ModelGatewayPrimitive } from "./model-provider";
export type {
  RawModelCalls,
  RawCallResult,
  RawClassifyInput,
  RawAgentInput,
  RawGenerateInput,
  RawAgentStream,
  RawAgentStreamPart,
} from "./raw-model-calls";
export { PROVIDER_CAP_REACHED_MESSAGE, PROVIDER_TRANSIENT_MESSAGE } from "./raw-model-calls";
export { createModelGateway } from "./gateway";
