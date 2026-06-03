/**
 * model-gateway — the platform's single, controlled entry to the model
 * (CONTEXT.md → Model gateway; ARCHITECTURE §3, §4).
 *
 * Pure *mechanism*: owns the Anthropic key + AI-SDK plumbing, exposes the fine
 * intent-level primitives `classify` / `runAgent` / `streamAgent` / `generate`.
 * Callers compose their own *method* on top — the gateway knows no evaluation
 * kinds. Every call carries an `AccountingTag` (`account` | `platform`); the
 * gateway routes accounting through the **usage** authority. The seam's
 * evaluators and the build loop depend on this port; the concrete adapter lives
 * in `infra/ai` and is wired in `container.ts`.
 *
 * Consumers: the build loop and evaluation (now); the portability transform and
 * mock-data generation (later) — all reuse the same port.
 */
export type {
  AccountingTag,
  GatewayTool,
  AgentStep,
  AgentStreamPart,
  Classification,
  AgentTurn,
  ClassifyInput,
  RunAgentInput,
  StreamAgentInput,
  GenerateInput,
  ModelGateway,
} from "./gateway.types";
export type { ModelProvider } from "./model-provider";
