import {
  createSdkMcpServer,
  query as sdkQuery,
  tool as sdkTool,
  type Options as ClaudeOptions,
  type Query,
  type SDKMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import {
  type AgentStep,
  type Classification,
  type GatewayMessage,
  type GatewaySystemPrompt,
  type GatewayTool,
  type RawAgentInput,
  type RawAgentStream,
  type RawAgentStreamPart,
  type RawCallResult,
  type RawClassifyInput,
  type RawGenerateInput,
  type RawModelCalls,
} from "@/modules/model-gateway";
import { validateAgainstSchema } from "@/modules/response-schema";
import type { ResolvedModel } from "@/modules/model-router";
import type { TokenUsageBreakdown } from "@/modules/usage";
import { domainError, err, ok, type DomainError, type Result } from "@/shared";

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_CONCURRENCY = 2;

export type ClaudeCodeQuery = (params: {
  prompt: string;
  options?: ClaudeOptions;
}) => AsyncIterable<SDKMessage> & { close(): void };

/** Claude Code subscription-backed RawModelCalls adapter. */
export function createClaudeCodeModelCalls(deps: {
  query?: ClaudeCodeQuery;
  timeoutMs?: number;
  concurrency?: number;
} = {}): RawModelCalls {
  const runQuery = deps.query ?? (sdkQuery as ClaudeCodeQuery);
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const semaphore = createSemaphore(deps.concurrency ?? DEFAULT_CONCURRENCY);

  async function structured<T>(
    system: string,
    prompt: string,
    schema: z.ZodType<T>,
  ): Promise<Result<RawCallResult<T>, DomainError>> {
    return semaphore(async () => {
      try {
        const jsonSchema = z.toJSONSchema(schema) as Record<string, unknown>;
        delete jsonSchema.$schema;
        const collected = await collectQuery(runQuery, timeoutMs, {
          prompt,
          options: baseOptions(system, {
            outputFormat: {
              type: "json_schema",
              schema: jsonSchema,
            },
          }),
        });
        if (collected.error) return err(modelUnavailable(collected.error));
        const parsed = schema.safeParse(collected.structuredOutput);
        if (!parsed.success) {
          return err(modelUnavailable("Claude Code returned invalid structured output.", parsed.error));
        }
        return ok({ value: parsed.data, usage: collected.usage });
      } catch (cause) {
        return err(modelUnavailable(withCause("Claude Code structured output failed.", cause), cause));
      }
    });
  }

  return {
    async classify(
      _resolved: ResolvedModel,
      input: RawClassifyInput,
    ): Promise<Result<RawCallResult<Classification>, DomainError>> {
      const result = await structured(
        "Classify the request. Return only the requested structured result.",
        classifyPrompt(input),
        z.object({
          choice: z.string(),
          rationale: z.string(),
        }),
      );
      if ("error" in result) return result;
      const selected = result.value.value.choice;
      return ok({
        value: {
          choice: selected.trim().toLowerCase() === "none" ? null : selected,
          rationale: result.value.value.rationale,
        },
        usage: result.value.usage,
      });
    },

    async generate<T>(
      _resolved: ResolvedModel,
      input: RawGenerateInput<T>,
    ): Promise<Result<RawCallResult<T>, DomainError>> {
      return structured(input.system, input.prompt, input.schema);
    },

    async runAgent(
      _resolved: ResolvedModel,
      input: RawAgentInput,
    ): Promise<Result<RawCallResult<{ transcript: readonly AgentStep[] }>, DomainError>> {
      return semaphore(async () => {
        try {
          const collected = await collectQuery(runQuery, timeoutMs, agentQuery(input, false));
          if (collected.error) return err(modelUnavailable(collected.error));
          return ok({ value: { transcript: collected.transcript }, usage: collected.usage });
        } catch (cause) {
          return err(modelUnavailable(withCause("Claude Code agent turn failed.", cause), cause));
        }
      });
    },

    streamAgent(_resolved: ResolvedModel, input: RawAgentInput): RawAgentStream {
      let usage = zeroUsage();
      async function* parts(): AsyncGenerator<RawAgentStreamPart> {
        const release = await semaphore.acquire();
        const toolNames = new Map<string, string>();
        try {
          const controller = new AbortController();
          const query = runQuery(agentQuery(input, true, controller));
          const timer = setTimeout(() => controller.abort(), timeoutMs);
          try {
            for await (const message of query) {
              usage = maxUsage(usage, usageFromMessage(message));
              for (const part of streamParts(message, toolNames)) yield part;
              if (message.type === "result") {
                if (message.subtype !== "success") {
                  yield { kind: "error", message: resultError(message) };
                } else {
                  yield { kind: "finish", finishReason: message.stop_reason ?? "stop" };
                }
              }
            }
          } finally {
            clearTimeout(timer);
            query.close();
          }
        } catch (cause) {
          yield {
            kind: "error",
            message: cause instanceof Error ? cause.message : "Claude Code stream failed.",
          };
        } finally {
          release();
        }
      }
      return { parts: parts(), usage: async () => usage };
    },
  };
}

function baseOptions(system: string, overrides: Partial<ClaudeOptions> = {}): ClaudeOptions {
  return {
    systemPrompt: system,
    tools: [],
    allowedTools: [],
    maxTurns: 8,
    permissionMode: "dontAsk",
    persistSession: false,
    strictMcpConfig: true,
    ...overrides,
  };
}

function agentQuery(
  input: RawAgentInput,
  streaming: boolean,
  abortController?: AbortController,
): { prompt: string; options: ClaudeOptions } {
  const gateway = createSdkMcpServer({
    name: "gateway",
    version: "1.0.0",
    tools: input.tools.map(toSdkTool),
  });
  return {
    prompt: conversationPrompt(input.messages),
    options: baseOptions(systemText(input.system), {
      abortController,
      includePartialMessages: streaming,
      mcpServers: { gateway },
      allowedTools: input.tools.map((tool) => `mcp__gateway__${tool.name}`),
    }),
  };
}

function toSdkTool(gatewayTool: GatewayTool) {
  const shape = jsonSchemaShape(gatewayTool.parameters);
  return sdkTool(gatewayTool.name, gatewayTool.description, shape, async (args) => {
    const issues = validateAgainstSchema(args, gatewayTool.parameters);
    if (issues.length > 0) {
      return {
        content: [{ type: "text" as const, text: issues.join("\n") }],
        isError: true,
      };
    }
    const output = await gatewayTool.handler(args);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(output ?? null) }],
    };
  });
}

function jsonSchemaShape(schema: Readonly<Record<string, unknown>>): Record<string, z.ZodType> {
  const properties = isRecord(schema.properties) ? schema.properties : {};
  const required = new Set(
    Array.isArray(schema.required)
      ? schema.required.filter((name): name is string => typeof name === "string")
      : [],
  );
  return Object.fromEntries(
    Object.entries(properties).map(([name, child]) => {
      const value = isRecord(child) ? zodFromJsonSchema(child) : z.unknown();
      return [name, required.has(name) ? value : value.optional()];
    }),
  );
}

function zodFromJsonSchema(schema: Readonly<Record<string, unknown>>): z.ZodType {
  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    const values = schema.enum.map((value) => z.literal(value as string | number | boolean | null));
    if (values.length === 1) return values[0]!;
    return z.union(values as unknown as [z.ZodType, z.ZodType, ...z.ZodType[]]);
  }
  if ("const" in schema) return z.literal(schema.const as string | number | boolean | null);
  switch (schema.type) {
    case "string":
      return z.string();
    case "number":
      return z.number();
    case "integer":
      return z.number().int();
    case "boolean":
      return z.boolean();
    case "null":
      return z.null();
    case "array":
      return z.array(isRecord(schema.items) ? zodFromJsonSchema(schema.items) : z.unknown());
    case "object":
      return z.object(jsonSchemaShape(schema));
    default:
      return z.unknown();
  }
}

async function collectQuery(
  runQuery: ClaudeCodeQuery,
  timeoutMs: number,
  params: { prompt: string; options?: ClaudeOptions },
): Promise<{
  structuredOutput: unknown;
  transcript: AgentStep[];
  usage: TokenUsageBreakdown;
  error?: string;
}> {
  const controller = new AbortController();
  const query = runQuery({
    ...params,
    options: { ...params.options, abortController: controller },
  });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let structuredOutput: unknown;
  let usage = zeroUsage();
  let error: string | undefined;
  const transcript: AgentStep[] = [];
  const toolNames = new Map<string, string>();
  try {
    for await (const message of query) {
      usage = maxUsage(usage, usageFromMessage(message));
      transcript.push(...transcriptSteps(message, toolNames));
      if (message.type === "result") {
        if (message.subtype === "success") structuredOutput = message.structured_output;
        else error = resultError(message);
      }
    }
  } finally {
    clearTimeout(timer);
    query.close();
  }
  return { structuredOutput, transcript, usage, error };
}

function transcriptSteps(message: SDKMessage, toolNames: Map<string, string>): AgentStep[] {
  if (message.type !== "assistant" && message.type !== "user") return [];
  const content = isRecord(message.message) && Array.isArray(message.message.content)
    ? message.message.content
    : [];
  return content.flatMap((block): AgentStep[] => {
    if (!isRecord(block)) return [];
    if (block.type === "text" && typeof block.text === "string") {
      return [{ kind: "model", text: block.text }];
    }
    if (block.type === "tool_use" && typeof block.name === "string") {
      if (typeof block.id === "string") toolNames.set(block.id, block.name);
      return [{ kind: "tool-call", tool: stripGatewayPrefix(block.name), input: block.input }];
    }
    if (block.type === "tool_result") {
      const name = typeof block.tool_use_id === "string" ? toolNames.get(block.tool_use_id) : undefined;
      return [{
        kind: "tool-result",
        tool: stripGatewayPrefix(name ?? ""),
        output: toolResultOutput(block.content),
      }];
    }
    return [];
  });
}

function streamParts(message: SDKMessage, toolNames: Map<string, string>): RawAgentStreamPart[] {
  if (message.type === "stream_event") {
    const event = message.event as unknown;
    if (!isRecord(event)) return [];
    if (event.type === "content_block_delta" && isRecord(event.delta) &&
        event.delta.type === "text_delta" && typeof event.delta.text === "string") {
      return [{ kind: "text", delta: event.delta.text }];
    }
    if (event.type === "content_block_start" && isRecord(event.content_block) &&
        event.content_block.type === "tool_use" && typeof event.content_block.name === "string") {
      if (typeof event.content_block.id === "string") {
        toolNames.set(event.content_block.id, event.content_block.name);
      }
      return [{ kind: "tool-call", tool: stripGatewayPrefix(event.content_block.name) }];
    }
    return [];
  }
  return transcriptSteps(message, toolNames).flatMap((step): RawAgentStreamPart[] => {
    if (step.kind === "tool-result") {
      return [{ kind: "tool-result", tool: step.tool, output: step.output }];
    }
    return [];
  });
}

function usageFromMessage(message: SDKMessage): TokenUsageBreakdown {
  if (message.type !== "result") return zeroUsage();
  const usage = message.usage as unknown;
  if (!isRecord(usage)) return zeroUsage();
  return {
    inputTokens: numberAt(usage, "input_tokens"),
    outputTokens: numberAt(usage, "output_tokens"),
    cacheReadInputTokens: numberAt(usage, "cache_read_input_tokens"),
    cacheCreationInputTokens: numberAt(usage, "cache_creation_input_tokens"),
  };
}

function classifyPrompt(input: RawClassifyInput): string {
  return `${input.prompt}\n\nChoices:\n${input.choices.map((choice) => `- ${choice}`).join("\n")}\nReturn "none" when no choice fits.`;
}

function conversationPrompt(messages: readonly GatewayMessage[]): string {
  return messages.map((message) => `${message.role.toUpperCase()}:\n${message.content}`).join("\n\n");
}

function systemText(system: GatewaySystemPrompt): string {
  return typeof system === "string" ? system : system.content;
}

function stripGatewayPrefix(name: string): string {
  return name.replace(/^mcp__gateway__/, "");
}

function toolResultOutput(content: unknown): unknown {
  if (!Array.isArray(content)) return content;
  const texts = content
    .filter(isRecord)
    .map((item) => item.text)
    .filter((text): text is string => typeof text === "string");
  if (texts.length !== 1) return texts;
  try {
    return JSON.parse(texts[0]!);
  } catch {
    return texts[0]!;
  }
}

function resultError(message: Extract<SDKMessage, { type: "result" }>): string {
  return message.subtype === "success"
    ? "Claude Code call failed."
    : message.errors.join("\n") || `Claude Code stopped: ${message.subtype}.`;
}

function modelUnavailable(message: string, cause?: unknown): DomainError {
  return domainError("model_unavailable", message, cause);
}

function withCause(message: string, cause: unknown): string {
  return cause instanceof Error && cause.message.trim().length > 0
    ? `${message} ${cause.message}`
    : message;
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
  return {
    inputTokens: Math.max(a.inputTokens, b.inputTokens),
    outputTokens: Math.max(a.outputTokens, b.outputTokens),
    cacheReadInputTokens: Math.max(a.cacheReadInputTokens, b.cacheReadInputTokens),
    cacheCreationInputTokens: Math.max(a.cacheCreationInputTokens, b.cacheCreationInputTokens),
  };
}

function numberAt(value: Record<string, unknown>, key: string): number {
  return typeof value[key] === "number" ? value[key] : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function createSemaphore(limit: number) {
  let active = 0;
  const waiters: Array<() => void> = [];
  const acquire = async (): Promise<() => void> => {
    if (active >= limit) await new Promise<void>((resolve) => waiters.push(resolve));
    active += 1;
    return () => {
      active -= 1;
      waiters.shift()?.();
    };
  };
  const run = async <T>(fn: () => Promise<T>): Promise<T> => {
    const release = await acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  };
  return Object.assign(run, { acquire });
}
