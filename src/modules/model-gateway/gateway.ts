import {
  checkCap,
  REQUEST_RATE_LIMIT,
  type RateLimitPolicy,
  type RequestRateLimiter,
  type TokenUsageBreakdown,
  type Tier,
  type UsageRepository,
} from "@/modules/usage";
import type { ModelRouter, ModelSelection, ResolvedModel } from "@/modules/model-router";
import {
  ok,
  err,
  domainError,
  isErr,
  LIMIT_MESSAGES,
  REQUEST_BYTES_MAX,
  type Result,
  type DomainError,
  type UserId,
} from "@/shared";
import type {
  ModelGateway,
  AccountingTag,
  GatewaySystemPrompt,
  ClassifyInput,
  RunAgentInput,
  StreamAgentInput,
  GenerateInput,
  Classification,
  AgentTurn,
  AgentStreamPart,
} from "./gateway.types";
import type { ModelGatewayPrimitive } from "./model-provider";
import { PROVIDER_CAP_REACHED_MESSAGE, type RawModelCalls } from "./raw-model-calls";

/**
 * The domain accounting shell over the raw model-calls port (#160) — the
 * platform's single metered entry to the model (CONTEXT.md → Model gateway).
 * Admission (tier cap, request rate limit, byte budget) and token recording
 * live *here*, applied to every `RawModelCalls` adapter by construction; the
 * adapter owns SDK translation only. The shell resolves the model per call
 * through the **model router** (runtime provider switching keeps working) and
 * depends on the **usage** authority for policy — the gateway is mechanism,
 * usage is policy.
 *
 * v1 accounting (CONTEXT.md → v1 accounting behaviour): `account` calls run
 * `checkCap` (structural caps) before spending and record tokens after; the
 * paid token-stream and the `platform` cost ledger are deferred — those tags
 * are carried and otherwise no-op.
 */
export function createModelGateway(deps: {
  router: ModelRouter;
  calls: RawModelCalls;
  usage: UsageRepository;
  /** Resolves a user's tier. v1 has no paid users, so this is "free" for now. */
  tierFor?: (userId: UserId) => Promise<Tier>;
  requestRateLimiter?: RequestRateLimiter;
  requestRateLimit?: RateLimitPolicy;
}): ModelGateway {
  const { router, calls, usage } = deps;
  const tierFor = deps.tierFor ?? (async () => "free" as Tier);
  const requestRateLimit = deps.requestRateLimit ?? REQUEST_RATE_LIMIT;

  /**
   * Gate a call before spending: resolve the model (so `model_unavailable`
   * wins over any policy error), enforce the byte budget, then for `account`
   * calls clear the tier cap and the request rate limit. `platform` calls skip
   * the cap (the platform owns that cost). Returns the resolved model to hand
   * to the raw port, or a DomainError.
   */
  async function admit(
    tag: AccountingTag,
    primitive: ModelGatewayPrimitive,
    inputBytes: number,
    target?: ModelSelection,
  ): Promise<Result<ResolvedModel, DomainError>> {
    const resolved = router.resolve(primitive, target);
    if (isErr(resolved)) return resolved;
    if (inputBytes > REQUEST_BYTES_MAX) {
      return err(domainError("input_too_large", LIMIT_MESSAGES.requestBytes));
    }
    if (tag.kind === "account") {
      const snapshot = await usage.get(tag.userId);
      if (isErr(snapshot)) return snapshot;
      const tier = await tierFor(tag.userId);
      // The caller declares which capability it is spending on; the cap it must
      // clear is capability-specific (free allows `test-run` but not
      // `triggering-eval`, ARCHITECTURE §8). The gateway forwards the tag — it
      // never names an evaluation kind itself (CONTEXT.md → Model gateway).
      const decision = checkCap(snapshot.value, tier, tag.capability);
      if (!decision.allowed) {
        return err(domainError("cap_reached", decision.reason));
      }
      if (deps.requestRateLimiter) {
        const rate = await deps.requestRateLimiter.consume(
          tag.userId,
          tag.capability,
          requestRateLimit,
        );
        if (isErr(rate)) return rate;
        if (!rate.value.allowed) {
          return err(domainError("cap_reached", rate.value.reason));
        }
      }
    }
    return ok(resolved.value);
  }

  /** Record a turn's token cost. `account` → usage stream; `platform`/paid → deferred no-op. */
  async function record(tag: AccountingTag, modelUsage: TokenUsageBreakdown): Promise<void> {
    if (tag.kind === "account") {
      await usage.increment(tag.userId, { usage: modelUsage, turns: 1 });
    }
    // platform: deferred cost ledger — tag carried, not yet recorded.
  }

  return {
    get hasModel() {
      return router.hasModel();
    },

    async classify(input: ClassifyInput): Promise<Result<Classification, DomainError>> {
      const admitted = await admit(input.tag, "classify", modelInputBytes([input.prompt]), input.target);
      if (isErr(admitted)) return admitted;

      const result = await calls.classify(admitted.value, {
        prompt: input.prompt,
        choices: input.choices,
      });
      if (isErr(result)) return result;
      await record(input.tag, result.value.usage);

      // Guard against a hallucinated label outside the allowed set.
      const { choice, rationale } = result.value.value;
      return ok({ choice: choice && input.choices.includes(choice) ? choice : null, rationale });
    },

    async runAgent(input: RunAgentInput): Promise<Result<AgentTurn, DomainError>> {
      const admitted = await admit(
        input.tag,
        "runAgent",
        modelInputBytes([
          systemPromptContent(input.system),
          ...input.messages.map((m) => m.content),
        ]),
        input.target,
      );
      if (isErr(admitted)) return admitted;

      const result = await calls.runAgent(admitted.value, {
        system: input.system,
        messages: input.messages,
        tools: input.tools,
      });
      if (isErr(result)) return result;
      await record(input.tag, result.value.usage);
      return ok(result.value.value);
    },

    async streamAgent(
      input: StreamAgentInput,
    ): Promise<Result<AsyncGenerator<AgentStreamPart>, DomainError>> {
      // Admit up front so cap_reached / model_unavailable surface as the outer
      // Result before any part streams; the raw stream is opened lazily inside
      // the generator.
      const admitted = await admit(
        input.tag,
        "streamAgent",
        modelInputBytes([
          systemPromptContent(input.system),
          ...input.messages.map((m) => m.content),
        ]),
        input.target,
      );
      if (isErr(admitted)) return admitted;
      const model = admitted.value;
      const { tag } = input;

      async function* stream(): AsyncGenerator<AgentStreamPart> {
        const raw = calls.streamAgent(model, {
          system: input.system,
          messages: input.messages,
          tools: input.tools,
        });
        let skipRecording = false;
        try {
          for await (const part of raw.parts) {
            if (part.kind === "provider-cap-error") {
              // Provider-detected cap: surface the domain message, spend nothing.
              skipRecording = true;
              yield { kind: "error", message: PROVIDER_CAP_REACHED_MESSAGE };
              continue;
            }
            yield part;
          }
        } finally {
          // Record once even when the consumer disconnects or the stream
          // throws — `usage()` settles to the adapter's best-known cost.
          if (!skipRecording) await record(tag, await raw.usage());
        }
      }

      return ok(stream());
    },

    async generate<T>(input: GenerateInput<T>): Promise<Result<T, DomainError>> {
      const admitted = await admit(
        input.tag,
        "generate",
        modelInputBytes([input.system, input.prompt]),
        input.target,
      );
      if (isErr(admitted)) return admitted;

      const result = await calls.generate(admitted.value, {
        system: input.system,
        prompt: input.prompt,
        schema: input.schema,
      });
      if (isErr(result)) return result;
      await record(input.tag, result.value.usage);
      return ok(result.value.value);
    },
  };
}

const encoder = new TextEncoder();

function modelInputBytes(parts: readonly string[]): number {
  return parts.reduce((total, part) => total + encoder.encode(part).byteLength, 0);
}

function systemPromptContent(system: GatewaySystemPrompt): string {
  return typeof system === "string" ? system : system.content;
}
