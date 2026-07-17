import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { GatewayTool, ModelGatewayPrimitive } from "@/modules/model-gateway";
import type { ResolvedModel } from "@/modules/model-router";
import type { TokenUsageBreakdown } from "@/modules/usage";
import { isErr } from "@/shared";
import { readConfig } from "@/server/config";
import { createModelRouter } from "./model-router";
import { createSdkModelCalls } from "./sdk-model-calls";

const target = process.env.CONFORMANCE_PROVIDER;
const timeout = 60_000;
const calls = createSdkModelCalls();
const agentInput = {
  system: "Call the echo tool exactly once with the value hello. Do not call any other tool.",
  messages: [{ role: "user" as const, content: "Echo hello." }],
  tools: [
    {
      name: "echo",
      description: "Returns the supplied value unchanged.",
      parameters: {
        type: "object",
        properties: { value: { type: "string" } },
        required: ["value"],
        additionalProperties: false,
      },
      handler: ({ value }) => ({ echoed: value }),
    } satisfies GatewayTool,
  ],
};

function router() {
  const config = readConfig();
  return createModelRouter({
    profiles: config.providerRegistry,
    serverKeys: config.serverKeys,
  });
}

function resolve(primitive: ModelGatewayPrimitive): ResolvedModel {
  const result = router().resolve(primitive, { providerId: target ?? "" });
  expect(
    isErr(result),
    `${primitive}: request rejected — ${isErr(result) ? result.error.message : "unknown error"}`,
  ).toBe(false);
  if (isErr(result)) throw new Error(result.error.message);
  return result.value;
}

function totalUsage(usage: TokenUsageBreakdown): number {
  return usage.inputTokens + usage.outputTokens + usage.cacheReadInputTokens + usage.cacheCreationInputTokens;
}

describe.skipIf(!target)("provider conformance", () => {
  it("resolves every gateway primitive", () => {
    for (const primitive of ["classify", "generate", "runAgent", "streamAgent"] as const) {
      expect(resolve(primitive).providerId, `${primitive}: request rejected — wrong provider`).toBe(target);
    }
  });

  it("classify selects an exact match", async () => {
    const result = await calls.classify(resolve("classify"), {
      choices: ["billing", "weather", "travel"],
      prompt: "The customer asks why their invoice was charged twice.",
    });
    expect(isErr(result), `classify: request rejected — ${isErr(result) ? result.error.message : ""}`).toBe(false);
    if (isErr(result)) return;
    expect(result.value.value.choice, "classify: output unparsable — exact choice missing").toBe("billing");
    expect(totalUsage(result.value.usage), "classify: usage missing").toBeGreaterThan(0);
  }, timeout);

  it("classify stays silent when nothing fits", async () => {
    const result = await calls.classify(resolve("classify"), {
      choices: ["billing", "weather", "travel"],
      prompt: "Write a two-line poem about a green button.",
    });
    expect(isErr(result), `classify silence: request rejected — ${isErr(result) ? result.error.message : ""}`).toBe(false);
    if (isErr(result)) return;
    expect(result.value.value.choice, "classify silence: output unparsable — expected no choice").toBeNull();
  }, timeout);

  it("generate returns schema-valid output", async () => {
    const schema = z.object({ title: z.string(), wordCount: z.number() });
    const result = await calls.generate(resolve("generate"), {
      system: "Return only the requested small object.",
      prompt: "Use title 'Hello' and wordCount 1.",
      schema,
    });
    expect(isErr(result), `generate: request rejected — ${isErr(result) ? result.error.message : ""}`).toBe(false);
    if (isErr(result)) return;
    expect(schema.safeParse(result.value.value).success, "generate: output unparsable").toBe(true);
    expect(totalUsage(result.value.usage), "generate: usage missing").toBeGreaterThan(0);
  }, timeout);

  it("runAgent calls and completes the echo tool", async () => {
    const result = await calls.runAgent(resolve("runAgent"), agentInput);
    expect(isErr(result), `runAgent: request rejected — ${isErr(result) ? result.error.message : ""}`).toBe(false);
    if (isErr(result)) return;
    const kinds = result.value.value.transcript.map((step) => step.kind);
    const call = kinds.indexOf("tool-call");
    const toolResult = kinds.indexOf("tool-result", call + 1);
    expect(call, "runAgent: output unparsable — tool-call missing").toBeGreaterThanOrEqual(0);
    expect(toolResult, "runAgent: output unparsable — tool-result missing after tool-call").toBeGreaterThan(call);
  }, timeout);

  it("streamAgent emits content, finishes, and reports usage", async () => {
    const stream = calls.streamAgent(resolve("streamAgent"), agentInput);
    const parts = [];
    for await (const part of stream.parts) parts.push(part);
    expect(parts.some((part) => part.kind === "text" || part.kind === "tool-call"), "streamAgent: output unparsable — no content").toBe(true);
    expect(parts.some((part) => part.kind === "finish"), "streamAgent: output unparsable — finish missing").toBe(true);
    expect(parts.some((part) => part.kind === "error" || part.kind === "provider-cap-error"), "streamAgent: request rejected — error part received").toBe(false);
    expect(totalUsage(await stream.usage()), "streamAgent: usage missing").toBeGreaterThan(0);
  }, timeout);
});
