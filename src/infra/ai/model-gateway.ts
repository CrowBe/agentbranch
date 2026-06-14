import { generateObject, generateText, streamText, tool, stepCountIs, jsonSchema } from "ai";
import type { LanguageModel, ModelMessage, SystemModelMessage, ToolSet } from "ai";
import { z } from "zod";
import {
  checkCap,
  REQUEST_RATE_LIMIT,
  type RateLimitPolicy,
  type RequestRateLimiter,
  type TokenUsageBreakdown,
  type Tier,
  type UsageRepository,
} from "@/modules/usage";
import type {
  ModelGateway,
  ModelProvider,
  ModelGatewayPrimitive,
  AccountingTag,
  GatewayCacheControl,
  GatewayMessage,
  GatewaySystemPrompt,
  GatewayTool,
  ClassifyInput,
  RunAgentInput,
  StreamAgentInput,
  GenerateInput,
  Classification,
  AgentTurn,
  AgentStep,
  AgentStreamPart,
} from "@/modules/model-gateway";
import type { ModelRouter } from "@/modules/model-router";
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

type GatewayModelProviderKind = "anthropic" | "nous";

const OUTPUT_LIMITS = {
  classify: 256,
  runAgent: 4_096,
  streamAgent: 16_000,
  generate: 2_048,
} as const;

const SONNET_EFFORT = {
  low: { providerOptions: { anthropic: { effort: "low" } } },
  medium: { providerOptions: { anthropic: { effort: "medium" } } },
} as const;

type EffortPair = typeof SONNET_EFFORT;

/** Anthropic's effort knob applies only to Sonnet-routed primitives. */
function effortFor(isAnthropic: boolean, modelId: string | undefined): EffortPair | null {
  return isAnthropic && modelId?.toLowerCase().includes("sonnet") ? SONNET_EFFORT : null;
}

const PROVIDER_CAP_REACHED_MESSAGE = "cap_reached: Out of free usage today.";

/**
 * Real model gateway — Claude via the Vercel AI SDK (NOT the Anthropic SDK
 * directly, ARCHITECTURE §4). The platform's single metered entry to the model
 * (CONTEXT.md → Model gateway). Owns the AI-SDK plumbing; depends on the usage
 * authority for accounting policy. Pure mechanism — no evaluation knowledge.
 *
 * v1 accounting (CONTEXT.md → v1 accounting behaviour): `account` calls run
 * `checkCap` (structural caps) before spending and record tokens after; the
 * paid token-stream and the `platform` cost ledger are deferred — those tags are
 * carried and otherwise no-op.
 */
export function createModelGateway(deps: {
  /**
   * Provider/model selection. A `router` resolves the model per call (runtime
   * provider switching, ARCHITECTURE §4 routing); a static `provider` is the
   * direct path (used by tests). Exactly one is expected — `router` wins.
   */
  router?: ModelRouter;
  provider?: ModelProvider;
  usage: UsageRepository;
  providerKind?: GatewayModelProviderKind;
  modelId?: string;
  /** Resolves a user's tier. v1 has no paid users, so this is "free" for now. */
  tierFor?: (userId: UserId) => Promise<Tier>;
  requestRateLimiter?: RequestRateLimiter;
  requestRateLimit?: RateLimitPolicy;
}): ModelGateway {
  const { router, provider, usage } = deps;
  const tierFor = deps.tierFor ?? (async () => "free" as Tier);
  const requestRateLimit = deps.requestRateLimit ?? REQUEST_RATE_LIMIT;

  /** The admitted model plus the (per-call) effort options it routes to. */
  type Admitted = { readonly model: LanguageModel; readonly effort: EffortPair | null };

  /**
   * Resolve the model for a primitive — through the router (runtime selection)
   * when present, else the static provider. Carries enough to decide effort
   * (Anthropic + Sonnet) per call, since the route can change at runtime.
   */
  function resolveModel(
    primitive: ModelGatewayPrimitive,
  ): Result<{ model: LanguageModel; isAnthropic: boolean; modelId: string | undefined }, DomainError> {
    if (router) {
      const resolved = router.resolve(primitive);
      if (isErr(resolved)) return resolved;
      return ok({
        model: resolved.value.model,
        isAnthropic: resolved.value.kind === "anthropic",
        modelId: resolved.value.modelId,
      });
    }
    const model = provider?.models?.[primitive] ?? provider?.model ?? null;
    if (!model) {
      return err(domainError("model_unavailable", "No model is configured."));
    }
    return ok({ model, isAnthropic: deps.providerKind === "anthropic", modelId: deps.modelId });
  }

  /**
   * Gate an `account` call against tier caps before spending. `platform` calls
   * skip the cap (the platform owns that cost). Returns the model to use (and its
   * effort options), or a DomainError (`model_unavailable` / `cap_reached`).
   */
  async function admit(
    tag: AccountingTag,
    primitive: ModelGatewayPrimitive,
    inputBytes: number,
  ): Promise<Result<Admitted, DomainError>> {
    const resolved = resolveModel(primitive);
    if (isErr(resolved)) return resolved;
    const { model } = resolved.value;
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
    return ok({ model, effort: effortFor(resolved.value.isAnthropic, resolved.value.modelId) });
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
      return router ? router.hasModel() : provider?.model != null;
    },

    async classify(input: ClassifyInput): Promise<Result<Classification, DomainError>> {
      const admitted = await admit(input.tag, "classify", modelInputBytes([input.prompt]));
      if (isErr(admitted)) return admitted;

      try {
        const { object, usage: u } = await generateObject({
          model: admitted.value.model,
          maxOutputTokens: OUTPUT_LIMITS.classify,
          schema: z.object({
            choice: z
              .string()
              .nullable()
              .describe("The label that best fits, or null if none fit."),
            rationale: z.string().describe("One short line: why this choice."),
          }),
          prompt: classifyPrompt(input.prompt, input.choices),
        });
        await record(input.tag, readTokenUsage(u));

        // Guard against a hallucinated label outside the allowed set.
        const choice =
          object.choice && input.choices.includes(object.choice) ? object.choice : null;
        return ok({ choice, rationale: object.rationale });
      } catch (cause) {
        return err(modelCallError("Classification call failed.", cause));
      }
    },

    async runAgent(input: RunAgentInput): Promise<Result<AgentTurn, DomainError>> {
      const admitted = await admit(
        input.tag,
        "runAgent",
        modelInputBytes([
          systemPromptContent(input.system),
          ...input.messages.map((m) => m.content),
        ]),
      );
      if (isErr(admitted)) return admitted;

      try {
        const result = await generateText({
          model: admitted.value.model,
          maxOutputTokens: OUTPUT_LIMITS.runAgent,
          ...admitted.value.effort?.medium,
          system: toSdkSystem(input.system),
          messages: input.messages.map(toSdkMessage),
          tools: toSdkTools(input.tools),
          stopWhen: stepCountIs(8),
        });
        await record(input.tag, readTokenUsage(result.usage));
        return ok({ transcript: transcriptFromSteps(result.steps) });
      } catch (cause) {
        return err(modelCallError("Agent turn failed.", cause));
      }
    },

    async streamAgent(
      input: StreamAgentInput,
    ): Promise<Result<AsyncGenerator<AgentStreamPart>, DomainError>> {
      // Admit up front so cap_reached / model_unavailable surface as the outer
      // Result before any part streams; the model is captured for the generator.
      const admitted = await admit(
        input.tag,
        "streamAgent",
        modelInputBytes([
          systemPromptContent(input.system),
          ...input.messages.map((m) => m.content),
        ]),
      );
      if (isErr(admitted)) return admitted;
      const model = admitted.value.model;
      const { tag } = input;

      async function* stream(): AsyncGenerator<AgentStreamPart> {
        let result: ReturnType<typeof streamText> | undefined;
        let latestKnownUsage = zeroUsage();
        let recorded = false;
        let skipRecording = false;
        const recordOnce = async () => {
          if (recorded || skipRecording || !result) return;
          recorded = true;
          await record(tag, await readStreamUsage(result, latestKnownUsage));
        };
        try {
          result = streamText({
            model,
            maxOutputTokens: OUTPUT_LIMITS.streamAgent,
            system: toSdkSystem(input.system),
            messages: input.messages.map(toSdkMessage),
            tools: toSdkTools(input.tools),
            stopWhen: stepCountIs(8),
          });
          for await (const rawPart of result.fullStream) {
            const part = rawPart as { type: string } & Record<string, unknown>;
            latestKnownUsage = maxUsage(latestKnownUsage, readTokenUsage(part));
            switch (part.type) {
              case "text-delta": {
                const delta = readString(part, "text") ?? readString(part, "textDelta");
                if (delta) yield { kind: "text", delta };
                break;
              }
              case "tool-call":
                yield { kind: "tool-call", tool: readString(part, "toolName") ?? "" };
                break;
              case "tool-result":
                yield {
                  kind: "tool-result",
                  tool: readString(part, "toolName") ?? "",
                  output: part.output ?? part.result,
                };
                break;
              case "finish":
                yield { kind: "finish", finishReason: readString(part, "finishReason") ?? "stop" };
                break;
              case "error":
                if (isProviderCapError(part.error)) {
                  skipRecording = true;
                  yield { kind: "error", message: PROVIDER_CAP_REACHED_MESSAGE };
                  break;
                }
                yield { kind: "error", message: String(part.error ?? "Unknown error") };
                break;
              default:
                break;
            }
          }
        } catch (cause) {
          if (isProviderCapError(cause)) {
            skipRecording = true;
            yield { kind: "error", message: PROVIDER_CAP_REACHED_MESSAGE };
            return;
          }
          throw cause;
        } finally {
          // Record once even when the consumer disconnects or the stream throws.
          // Prefer SDK totals, but fall back to the latest usage attached to a
          // stream part when the final usage promise is unavailable.
          await recordOnce();
        }
      }

      return ok(stream());
    },

    async generate<T>(input: GenerateInput<T>): Promise<Result<T, DomainError>> {
      const admitted = await admit(
        input.tag,
        "generate",
        modelInputBytes([input.system, input.prompt]),
      );
      if (isErr(admitted)) return admitted;

      try {
        const { object, usage: u } = await generateObject({
          model: admitted.value.model,
          maxOutputTokens: OUTPUT_LIMITS.generate,
          ...admitted.value.effort?.low,
          schema: input.schema,
          system: input.system,
          prompt: input.prompt,
        });
        await record(input.tag, readTokenUsage(u));
        return ok(object);
      } catch (cause) {
        return err(modelCallError("Generation call failed.", cause));
      }
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

function toAnthropicProviderOptions(cacheControl: GatewayCacheControl | undefined) {
  return cacheControl ? { anthropic: { cacheControl } } : undefined;
}

function toSdkSystem(system: GatewaySystemPrompt): string | SystemModelMessage {
  if (typeof system === "string") return system;
  return {
    role: "system",
    content: system.content,
    providerOptions: toAnthropicProviderOptions(system.cacheControl),
  };
}

function toSdkMessage(message: GatewayMessage): ModelMessage {
  return {
    role: message.role,
    content: message.content,
    providerOptions: toAnthropicProviderOptions(message.cacheControl),
  };
}

/** Adapt the gateway's `GatewayTool`s to the AI SDK's tool map (shared by run/stream). */
function toSdkTools(tools: readonly GatewayTool[]): ToolSet {
  return Object.fromEntries(
    tools.map((t) => [
      t.name,
      tool({
        description: t.description,
        inputSchema: jsonSchema(t.parameters),
        execute: async (args: unknown) => t.handler(args as Record<string, unknown>),
      }),
    ]),
  );
}

function readString(obj: Record<string, unknown>, key: string): string | undefined {
  const value = obj[key];
  return typeof value === "string" ? value : undefined;
}

async function readStreamUsage(
  result: { totalUsage?: PromiseLike<unknown>; usage?: PromiseLike<unknown> },
  fallback: TokenUsageBreakdown,
): Promise<TokenUsageBreakdown> {
  for (const usage of [result.totalUsage, result.usage]) {
    if (!usage) continue;
    try {
      const modelUsage = readTokenUsage(await usage);
      if (totalTokens(modelUsage) > 0) return modelUsage;
    } catch {
      // Fall through to any known in-stream usage.
    }
  }
  return fallback;
}

function readTokenUsage(value: unknown): TokenUsageBreakdown {
  if (!value || typeof value !== "object") return zeroUsage();
  const obj = value as Record<string, unknown>;
  const cacheReadInputTokens = firstNumberDeep(obj, [
    "cacheReadInputTokens",
    "cache_read_input_tokens",
    "cacheReadTokens",
    "cachedInputTokens",
    "cached_input_tokens",
  ]);
  const cacheCreationInputTokens = firstNumberDeep(obj, [
    "cacheCreationInputTokens",
    "cache_creation_input_tokens",
    "cacheWriteTokens",
  ]);
  const rawInputTokens = firstNumberDeep(obj, [
    "inputTokens",
    "input_tokens",
    "promptTokens",
    "prompt_tokens",
  ]);
  const outputTokens = firstNumberDeep(obj, [
    "outputTokens",
    "output_tokens",
    "completionTokens",
    "completion_tokens",
  ]);
  const total = firstNumberDeep(obj, ["totalTokens", "total_tokens"]);

  const billedInputTokens =
    rawInputTokens === undefined
      ? Math.max(0, (total ?? 0) - (outputTokens ?? 0))
      : Math.max(0, rawInputTokens - (cacheReadInputTokens ?? 0) - (cacheCreationInputTokens ?? 0));

  return {
    inputTokens: billedInputTokens,
    outputTokens: outputTokens ?? Math.max(0, (total ?? 0) - billedInputTokens),
    cacheReadInputTokens: cacheReadInputTokens ?? 0,
    cacheCreationInputTokens: cacheCreationInputTokens ?? 0,
  };
}

function zeroUsage(): TokenUsageBreakdown {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
  };
}

function maxUsage(a: TokenUsageBreakdown, b: TokenUsageBreakdown): TokenUsageBreakdown {
  return totalTokens(b) > totalTokens(a) ? b : a;
}

function totalTokens(usage: TokenUsageBreakdown): number {
  return (
    usage.inputTokens +
    usage.outputTokens +
    usage.cacheReadInputTokens +
    usage.cacheCreationInputTokens
  );
}

function firstNumberDeep(value: unknown, keys: readonly string[]): number | undefined {
  const visited = new Set<unknown>();
  const stack: unknown[] = [value];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || typeof current !== "object" || visited.has(current)) continue;
    visited.add(current);
    const obj = current as Record<string, unknown>;
    for (const key of keys) {
      const number = readNumber(obj, key);
      if (number !== undefined) return number;
    }
    for (const nested of Object.values(obj)) {
      if (nested && typeof nested === "object") stack.push(nested);
    }
  }
  return undefined;
}

function readNumber(obj: Record<string, unknown>, key: string): number | undefined {
  const value = obj[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function modelCallError(message: string, cause: unknown): DomainError {
  if (isProviderCapError(cause)) {
    return domainError("cap_reached", PROVIDER_CAP_REACHED_MESSAGE, cause);
  }
  return domainError("model_unavailable", message, cause);
}

function isProviderCapError(value: unknown): boolean {
  const visited = new Set<unknown>();
  const stack: unknown[] = [value];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || visited.has(current)) continue;
    visited.add(current);

    if (typeof current === "string") {
      if (providerCapTextPattern.test(current)) return true;
      continue;
    }
    if (typeof current !== "object") continue;

    const obj = current as Record<string, unknown>;
    if (readNumber(obj, "status") === 429 || readNumber(obj, "statusCode") === 429) {
      return true;
    }

    for (const key of ["code", "type", "name", "message", "error"]) {
      const nested = obj[key];
      if (typeof nested === "string" && providerCapTextPattern.test(nested)) {
        return true;
      }
      if (nested && typeof nested === "object") stack.push(nested);
    }

    for (const key of ["cause", "response", "data", "body"]) {
      const nested = obj[key];
      if (nested && typeof nested === "object") stack.push(nested);
    }
  }
  return false;
}

const providerCapTextPattern =
  /\b(429|rate[-\s]?limit(?:ed)?|quota|billing|credit|insufficient[_\s-]?quota)\b/i;

function classifyPrompt(prompt: string, choices: readonly string[]): string {
  const list = choices.map((c, i) => `${i + 1}. ${c}`).join("\n");
  return `Given the request below, pick the single best-matching option, or null if none fit.\n\nRequest:\n${prompt}\n\nOptions:\n${list}`;
}

/** Flatten the SDK's step/content model into our transcript shape. */
function transcriptFromSteps(steps: ReadonlyArray<unknown>): AgentStep[] {
  const out: AgentStep[] = [];
  for (const raw of steps) {
    const step = raw as { text?: string; toolCalls?: unknown[]; toolResults?: unknown[] };
    if (step.text) out.push({ kind: "model", text: step.text });
    for (const c of step.toolCalls ?? []) {
      const call = c as { toolName?: string; input?: unknown };
      out.push({ kind: "tool-call", tool: call.toolName ?? "", input: call.input });
    }
    for (const r of step.toolResults ?? []) {
      const res = r as { toolName?: string; output?: unknown };
      out.push({ kind: "tool-result", tool: res.toolName ?? "", output: res.output });
    }
  }
  return out;
}
