import { generateObject, generateText, tool, stepCountIs, jsonSchema } from "ai";
import type { LanguageModel } from "ai";
import { z } from "zod";
import type { ModelProvider } from "@/modules/build-loop";
import { checkCap, type Tier, type UsageRepository } from "@/modules/usage";
import type {
  ModelGateway,
  AccountingTag,
  ClassifyInput,
  RunAgentInput,
  GenerateInput,
  Classification,
  AgentTurn,
  AgentStep,
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
      const decision = checkCap(snapshot.value, tier, "test-run");
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

      const tools = Object.fromEntries(
        input.tools.map((t) => [
          t.name,
          tool({
            description: t.description,
            inputSchema: jsonSchema(t.parameters),
            execute: async (args: unknown) => t.handler(args as Record<string, unknown>),
          }),
        ]),
      );

      try {
        const result = await generateText({
          model: admitted.value,
          system: input.system,
          messages: input.messages.map((m) => ({ role: m.role, content: m.content })),
          tools,
          stopWhen: stepCountIs(8),
        });
        await record(input.tag, result.usage?.totalTokens ?? 0);
        return ok({ transcript: transcriptFromSteps(result.steps) });
      } catch (cause) {
        return err(domainError("model_unavailable", "Agent turn failed.", cause));
      }
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
