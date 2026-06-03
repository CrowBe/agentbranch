import { generateObject, generateText, streamText, tool, stepCountIs, jsonSchema } from "ai";
import type { LanguageModel, ToolSet } from "ai";
import { z } from "zod";
import { checkCap, type Tier, type UsageRepository } from "@/modules/usage";
import type {
  ModelGateway,
  ModelProvider,
  AccountingTag,
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
import {
  ok,
  err,
  domainError,
  isErr,
  type Result,
  type DomainError,
  type UserId,
} from "@/shared";

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
  provider: ModelProvider;
  usage: UsageRepository;
  /** Resolves a user's tier. v1 has no paid users, so this is "free" for now. */
  tierFor?: (userId: UserId) => Promise<Tier>;
}): ModelGateway {
  const { provider, usage } = deps;
  const tierFor = deps.tierFor ?? (async () => "free" as Tier);

  /**
   * Gate an `account` call against tier caps before spending. `platform` calls
   * skip the cap (the platform owns that cost). Returns the model to use, or a
   * DomainError (`model_unavailable` / `cap_reached`).
   */
  async function admit(
    tag: AccountingTag,
  ): Promise<Result<LanguageModel, DomainError>> {
    if (!provider.model) {
      return err(domainError("model_unavailable", "No model is configured."));
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
    }
    return ok(provider.model);
  }

  /** Record a turn's token cost. `account` → usage stream; `platform`/paid → deferred no-op. */
  async function record(tag: AccountingTag, tokens: number): Promise<void> {
    if (tag.kind === "account") {
      await usage.increment(tag.userId, { tokens, turns: 1 });
    }
    // platform: deferred cost ledger — tag carried, not yet recorded.
  }

  return {
    get hasModel() {
      return provider.model !== null;
    },

    async classify(input: ClassifyInput): Promise<Result<Classification, DomainError>> {
      const admitted = await admit(input.tag);
      if (isErr(admitted)) return admitted;

      try {
        const { object, usage: u } = await generateObject({
          model: admitted.value,
          schema: z.object({
            choice: z
              .string()
              .nullable()
              .describe("The label that best fits, or null if none fit."),
            rationale: z.string().describe("One short line: why this choice."),
          }),
          prompt: classifyPrompt(input.prompt, input.choices),
        });
        await record(input.tag, u?.totalTokens ?? 0);

        // Guard against a hallucinated label outside the allowed set.
        const choice =
          object.choice && input.choices.includes(object.choice) ? object.choice : null;
        return ok({ choice, rationale: object.rationale });
      } catch (cause) {
        return err(domainError("model_unavailable", "Classification call failed.", cause));
      }
    },

    async runAgent(input: RunAgentInput): Promise<Result<AgentTurn, DomainError>> {
      const admitted = await admit(input.tag);
      if (isErr(admitted)) return admitted;

      try {
        const result = await generateText({
          model: admitted.value,
          system: input.system,
          messages: input.messages.map((m) => ({ role: m.role, content: m.content })),
          tools: toSdkTools(input.tools),
          stopWhen: stepCountIs(8),
        });
        await record(input.tag, result.usage?.totalTokens ?? 0);
        return ok({ transcript: transcriptFromSteps(result.steps) });
      } catch (cause) {
        return err(domainError("model_unavailable", "Agent turn failed.", cause));
      }
    },

    async streamAgent(
      input: StreamAgentInput,
    ): Promise<Result<AsyncGenerator<AgentStreamPart>, DomainError>> {
      // Admit up front so cap_reached / model_unavailable surface as the outer
      // Result before any part streams; the model is captured for the generator.
      const admitted = await admit(input.tag);
      if (isErr(admitted)) return admitted;
      const model = admitted.value;
      const { tag } = input;

      async function* stream(): AsyncGenerator<AgentStreamPart> {
        const result = streamText({
          model,
          system: input.system,
          messages: input.messages.map((m) => ({ role: m.role, content: m.content })),
          tools: toSdkTools(input.tools),
          stopWhen: stepCountIs(8),
        });
        try {
          for await (const rawPart of result.fullStream) {
            const part = rawPart as { type: string } & Record<string, unknown>;
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
                yield { kind: "error", message: String(part.error ?? "Unknown error") };
                break;
              default:
                break;
            }
          }
        } finally {
          // Best-effort accounting once the stream settles. totalUsage resolves
          // after the run; on a mid-stream failure we record what we can.
          let tokens = 0;
          try {
            const totals = await result.totalUsage;
            tokens = totals?.totalTokens ?? 0;
          } catch {
            tokens = 0;
          }
          await record(tag, tokens);
        }
      }

      return ok(stream());
    },

    async generate<T>(input: GenerateInput<T>): Promise<Result<T, DomainError>> {
      const admitted = await admit(input.tag);
      if (isErr(admitted)) return admitted;

      try {
        const { object, usage: u } = await generateObject({
          model: admitted.value,
          schema: input.schema,
          system: input.system,
          prompt: input.prompt,
        });
        await record(input.tag, u?.totalTokens ?? 0);
        return ok(object);
      } catch (cause) {
        return err(domainError("model_unavailable", "Generation call failed.", cause));
      }
    },
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
