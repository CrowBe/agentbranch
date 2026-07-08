import { generateObject, generateText, streamText, tool, stepCountIs, jsonSchema } from "ai";
import type { ModelMessage, SystemModelMessage, ToolSet } from "ai";
import { z } from "zod";
import type { TokenUsageBreakdown } from "@/modules/usage";
import {
  PROVIDER_CAP_REACHED_MESSAGE,
  type RawModelCalls,
  type RawCallResult,
  type RawClassifyInput,
  type RawAgentInput,
  type RawGenerateInput,
  type RawAgentStream,
  type RawAgentStreamPart,
  type GatewayCacheControl,
  type GatewayMessage,
  type GatewaySystemPrompt,
  type GatewayTool,
  type Classification,
  type AgentTurn,
  type AgentStep,
} from "@/modules/model-gateway";
import type { ResolvedModel } from "@/modules/model-router";
import { ok, err, domainError, type Result, type DomainError } from "@/shared";

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
function effortFor(resolved: ResolvedModel): EffortPair | null {
  return resolved.kind === "anthropic" && resolved.modelId?.toLowerCase().includes("sonnet")
    ? SONNET_EFFORT
    : null;
}

/**
 * Raw model-calls adapter — Claude via the Vercel AI SDK (NOT the Anthropic
 * SDK directly, ARCHITECTURE §4). SDK *translation only* (#160): message/tool
 * mapping, stream-part mapping, token-usage shape reading, provider cap-error
 * detection. Admission and recording live above, in the model-gateway module's
 * accounting shell — nothing here knows a tag, a cap, or a user. The model
 * arrives already resolved (the shell asks the router), so nothing here
 * selects a provider either.
 */
export function createSdkModelCalls(): RawModelCalls {
  return {
    async classify(
      resolved: ResolvedModel,
      input: RawClassifyInput,
    ): Promise<Result<RawCallResult<Classification>, DomainError>> {
      try {
        const { object, usage } = await generateObject({
          model: resolved.model,
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
        return ok({
          value: { choice: object.choice, rationale: object.rationale },
          usage: readTokenUsage(usage),
        });
      } catch (cause) {
        return err(modelCallError("Classification call failed.", cause));
      }
    },

    async runAgent(
      resolved: ResolvedModel,
      input: RawAgentInput,
    ): Promise<Result<RawCallResult<AgentTurn>, DomainError>> {
      try {
        const result = await generateText({
          model: resolved.model,
          maxOutputTokens: OUTPUT_LIMITS.runAgent,
          ...effortFor(resolved)?.medium,
          system: toSdkSystem(input.system),
          messages: input.messages.map(toSdkMessage),
          tools: toSdkTools(input.tools),
          stopWhen: stepCountIs(8),
        });
        return ok({
          value: { transcript: transcriptFromSteps(result.steps) },
          usage: readTokenUsage(result.usage),
        });
      } catch (cause) {
        return err(modelCallError("Agent turn failed.", cause));
      }
    },

    streamAgent(resolved: ResolvedModel, input: RawAgentInput): RawAgentStream {
      let result: ReturnType<typeof streamText> | undefined;
      let latestKnownUsage = zeroUsage();

      async function* parts(): AsyncGenerator<RawAgentStreamPart> {
        try {
          result = streamText({
            model: resolved.model,
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
                  yield { kind: "provider-cap-error" };
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
            yield { kind: "provider-cap-error" };
            return;
          }
          throw cause;
        }
      }

      return {
        parts: parts(),
        // Prefer SDK totals, but fall back to the latest usage attached to a
        // stream part when the final usage promise is unavailable (consumer
        // disconnect, mid-stream throw).
        usage: async () => (result ? readStreamUsage(result, latestKnownUsage) : latestKnownUsage),
      };
    },

    async generate<T>(
      resolved: ResolvedModel,
      input: RawGenerateInput<T>,
    ): Promise<Result<RawCallResult<T>, DomainError>> {
      try {
        const { object, usage } = await generateObject({
          model: resolved.model,
          maxOutputTokens: OUTPUT_LIMITS.generate,
          ...effortFor(resolved)?.low,
          schema: input.schema,
          system: input.system,
          prompt: input.prompt,
        });
        return ok({ value: object, usage: readTokenUsage(usage) });
      } catch (cause) {
        return err(modelCallError("Generation call failed.", cause));
      }
    },
  };
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
