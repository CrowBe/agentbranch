import type { z } from "zod";
import type { GatedCapability } from "@/modules/usage";
import type { Result, DomainError, UserId } from "@/shared";

/**
 * Who pays for a model call. The *caller* declares this on every call, because
 * only the caller knows *why* it is spending (CONTEXT.md → Accounting tag):
 *
 * - `account`  — user-attributable work, subject to tier policy (the build
 *   loop's turns, a user's triggering eval). Runs through the usage authority.
 *   Carries the `capability` it is spending on, because the cap it must clear is
 *   capability-specific (free allows `test-run` but not `triggering-eval`,
 *   ARCHITECTURE §8) — and only the caller knows *which* capability it is. The
 *   gateway forwards it to the usage authority; it stays ignorant of what the
 *   capability *means*.
 * - `platform` — the platform's own cost to enable a feature (e.g. generating
 *   mock data to stress *the* skill). Never charged to a user's allowance;
 *   recorded to our own cost ledger (deferred in v1).
 */
export type AccountingTag =
  | { readonly kind: "account"; readonly userId: UserId; readonly capability: GatedCapability }
  | { readonly kind: "platform"; readonly reason: string };

/**
 * A tool the model may call during `runAgent`. The caller supplies the
 * `handler` — the gateway drives the loop, but the tool's *behaviour* is the
 * caller's method (e.g. the test run backs `handler` with its mock-tool
 * registry). `parameters` is a JSON-schema-shaped object the SDK validates.
 */
export type GatewayTool = {
  readonly name: string;
  readonly description: string;
  readonly parameters: Readonly<Record<string, unknown>>;
  handler(input: Readonly<Record<string, unknown>>): unknown | Promise<unknown>;
};

/** One step of an agent turn's transcript (mirrors test-run's TranscriptStep). */
export type AgentStep =
  | { readonly kind: "model"; readonly text: string }
  | { readonly kind: "tool-call"; readonly tool: string; readonly input: unknown }
  | { readonly kind: "tool-result"; readonly tool: string; readonly output: unknown };

/**
 * One part of a *streaming* agent turn (`streamAgent`). The gateway maps the
 * AI-SDK's stream parts onto this stable, intent-level shape — absorbing
 * SDK-version field churn at the gateway boundary so callers (the build loop)
 * map *domain* meaning (parse a SKILL.md) rather than SDK internals.
 */
export type AgentStreamPart =
  | { readonly kind: "text"; readonly delta: string }
  | { readonly kind: "tool-call"; readonly tool: string }
  | { readonly kind: "tool-result"; readonly tool: string; readonly output: unknown }
  | { readonly kind: "finish"; readonly finishReason: string }
  | { readonly kind: "error"; readonly message: string };

/** The result of `classify` — the winning label or null, plus the model's own reason. */
export type Classification = {
  /** The selected choice, or `null` when nothing fit ("stayed silent"). */
  readonly choice: string | null;
  /** The model's stated one-line reason — captured, not an invented confidence. */
  readonly rationale: string;
};

/** The result of `runAgent` — the transcript only. Tokens are recorded internally. */
export type AgentTurn = {
  readonly transcript: readonly AgentStep[];
};

export type ClassifyInput = {
  readonly prompt: string;
  readonly choices: readonly string[];
  readonly tag: AccountingTag;
};

export type RunAgentInput = {
  readonly system: GatewaySystemPrompt;
  readonly messages: readonly GatewayMessage[];
  readonly tools: readonly GatewayTool[];
  readonly tag: AccountingTag;
};

/** Input to `streamAgent` — same shape as a one-shot agent turn, streamed. */
export type StreamAgentInput = RunAgentInput;

export type GatewaySystemPrompt =
  | string
  | {
      readonly content: string;
      readonly cacheControl?: GatewayCacheControl;
    };

export type GatewayMessage = {
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly cacheControl?: GatewayCacheControl;
};

export type GatewayCacheControl = {
  readonly type: "ephemeral";
  readonly ttl?: "5m" | "1h";
};

export type GenerateInput<T> = {
  readonly system: string;
  readonly prompt: string;
  /** Zod schema the structured output is validated against; infers `T`. */
  readonly schema: z.ZodType<T>;
  readonly tag: AccountingTag;
};

/**
 * The platform's single, controlled entry to the model (CONTEXT.md → Model
 * gateway). Pure *mechanism*: it owns the key + AI-SDK plumbing and exposes fine
 * intent-level primitives that callers compose into their own method. It knows
 * nothing about "selection", "scenario", a build turn, or any capability kind.
 *
 * Every call carries an `AccountingTag`; the gateway routes accounting through
 * the usage authority (records `account` tokens, no-ops `platform`/paid in v1).
 *
 * Failure modes (closed DomainError union):
 * - `model_unavailable` — no model configured (offline / no key).
 * - `cap_reached`       — a model exists, but an `account` call hit a tier cap
 *   (the §8 graceful-degradation catch — "out of free usage today").
 * - `input_too_large`   — the final model input exceeds the gateway budget.
 */
export interface ModelGateway {
  /** True when a model is configured. False → calls fail `model_unavailable`. */
  readonly hasModel: boolean;

  /** One structured single-shot pick from `choices` (or null = none fit). */
  classify(input: ClassifyInput): Promise<Result<Classification, DomainError>>;

  /**
   * One metered agent turn. The gateway runs the loop; on a tool call it invokes
   * the matching tool's caller-supplied `handler`. Token usage is recorded
   * internally against the tag — the transcript comes back, tokens do not.
   */
  runAgent(input: RunAgentInput): Promise<Result<AgentTurn, DomainError>>;

  /**
   * One metered *streaming* agent turn. Admits against the tag's cap up front —
   * so `cap_reached` / `model_unavailable` surface as the outer `Result` *before*
   * any part streams — then returns a generator of `AgentStreamPart`s. Tokens are
   * recorded internally once the stream completes. This is the build loop's entry
   * to the model: the hero preview needs deltas as they arrive, not a final turn.
   */
  streamAgent(
    input: StreamAgentInput,
  ): Promise<Result<AsyncGenerator<AgentStreamPart>, DomainError>>;

  /**
   * One metered free-form structured-output call, validated against `schema`.
   * Unlike `classify` (a fixed pick), this produces arbitrary structured data —
   * an evaluator uses it to turn its raw result into a plain-language Insight.
   */
  generate<T>(input: GenerateInput<T>): Promise<Result<T, DomainError>>;
}
