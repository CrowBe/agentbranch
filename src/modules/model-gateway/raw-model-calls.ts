import type { z } from "zod";
import type { ResolvedModel } from "@/modules/model-router";
import type { TokenUsageBreakdown } from "@/modules/usage";
import type { Result, DomainError } from "@/shared";
import type {
  AgentStreamPart,
  AgentTurn,
  Classification,
  GatewayMessage,
  GatewaySystemPrompt,
  GatewayTool,
} from "./gateway.types";

/**
 * The message a provider-detected cap failure surfaces with — domain copy, so
 * both the shell (stream error parts) and the raw adapter (thrown-call mapping)
 * say the same thing. `cap_reached` semantics: ARCHITECTURE §8.
 */
export const PROVIDER_CAP_REACHED_MESSAGE = "cap_reached: Out of free usage today.";

/** The retryable message for provider throttling that is not a spend cap. */
export const PROVIDER_TRANSIENT_MESSAGE =
  "The model provider rate-limited this request — try again shortly.";

/** What an unmetered raw call spent, alongside what it produced. */
export type RawCallResult<T> = {
  readonly value: T;
  readonly usage: TokenUsageBreakdown;
};

export type RawClassifyInput = {
  readonly prompt: string;
  readonly choices: readonly string[];
};

export type RawAgentInput = {
  readonly system: GatewaySystemPrompt;
  readonly messages: readonly GatewayMessage[];
  readonly tools: readonly GatewayTool[];
};

export type RawGenerateInput<T> = {
  readonly system: string;
  readonly prompt: string;
  readonly schema: z.ZodType<T>;
};

/**
 * One part of a *raw* streaming agent turn. The adapter speaks the public
 * `AgentStreamPart` shape plus one extra member: a provider-detected cap
 * failure, kept distinct so the shell can apply its policy (surface the domain
 * cap message, skip recording) rather than the adapter deciding either.
 */
export type RawAgentStreamPart = AgentStreamPart | { readonly kind: "provider-cap-error" };

/**
 * A raw streaming turn in flight. `parts` is the translated stream; `usage()`
 * settles to the turn's best-known token cost — the SDK's totals when they
 * resolve, else the latest usage observed on a stream part (so the shell can
 * record something truthful even after a consumer disconnect or a mid-stream
 * throw).
 */
export type RawAgentStream = {
  readonly parts: AsyncGenerator<RawAgentStreamPart>;
  usage(): Promise<TokenUsageBreakdown>;
};

/**
 * Raw model-calls port — *unmetered* model access, one method per gateway
 * primitive (CONTEXT.md → Model gateway; #160). The infra adapter owns SDK
 * translation only: message/tool mapping, stream-part mapping, token-usage
 * shape reading, provider cap-error detection. Everything about *whether* a
 * call may happen and *who pays* lives above this port, in the accounting
 * shell (`createModelGateway`) — which is why nothing here takes an
 * `AccountingTag` and every return carries its `TokenUsageBreakdown`.
 *
 * The shell resolves the model through the model router and hands the
 * `ResolvedModel` in, so this port never selects a provider either.
 *
 * Failures come back on the closed `DomainError` union with provider cap
 * failures already mapped to `cap_reached` and everything else to
 * `model_unavailable` (reading provider error shapes is translation).
 */
export interface RawModelCalls {
  classify(
    model: ResolvedModel,
    input: RawClassifyInput,
  ): Promise<Result<RawCallResult<Classification>, DomainError>>;

  runAgent(
    model: ResolvedModel,
    input: RawAgentInput,
  ): Promise<Result<RawCallResult<AgentTurn>, DomainError>>;

  streamAgent(model: ResolvedModel, input: RawAgentInput): RawAgentStream;

  generate<T>(
    model: ResolvedModel,
    input: RawGenerateInput<T>,
  ): Promise<Result<RawCallResult<T>, DomainError>>;
}
