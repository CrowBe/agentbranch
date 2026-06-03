/**
 * model-gateway — the platform's single, controlled entry to the model
 * (CONTEXT.md → Model gateway; ARCHITECTURE §3, §4).
 *
 * Pure *mechanism*: owns the Anthropic key + AI-SDK plumbing, exposes the fine
 * intent-level primitives `classify` / `runAgent`. Callers compose their own
 * *method* on top — the gateway knows no evaluation kinds. Every call carries an
 * `AccountingTag` (`account` | `platform`); the gateway routes accounting through
 * the **usage** authority. The seam's evaluators depend on this port; the
 * concrete adapter lives in `infra/ai` and is wired in `container.ts`.
 *
 * Consumers: evaluation (now); the portability transform, mock-data generation,
 * and eventually the build loop (later) — all reuse the same port.
 */
export type {
  AccountingTag,
  GatewayTool,
  AgentStep,
  Classification,
  AgentTurn,
  ClassifyInput,
  RunAgentInput,
  GenerateInput,
  ModelGateway,
} from "./gateway.types";
