import { describe, it, expect } from "vitest";
import { runResponseSchemaLoop, type ResponseSchemaLoopEvent } from "./response-schema-loop";
import { RESPONSE_SCHEMA_AUTHORING_PROMPT } from "./response-schema-prompt";
import { responseSchemaTools } from "./response-schema-tools";
import type {
  ModelGateway,
  AgentStreamPart,
  StreamAgentInput,
} from "@/modules/model-gateway";
import { ok, err, domainError, UserId, type Result, type DomainError } from "@/shared";

const userId = UserId("u1");

async function collect(
  gen: AsyncGenerator<ResponseSchemaLoopEvent>,
): Promise<ResponseSchemaLoopEvent[]> {
  const out: ResponseSchemaLoopEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

function fakeGateway(
  outcome: AgentStreamPart[] | DomainError,
  onInput?: (input: StreamAgentInput) => void,
): ModelGateway {
  return {
    hasModel: true,
    classify: async () => err(domainError("model_unavailable", "n/a")),
    runAgent: async () => err(domainError("model_unavailable", "n/a")),
    generate: async () => err(domainError("model_unavailable", "n/a")),
    async streamAgent(
      input: StreamAgentInput,
    ): Promise<Result<AsyncGenerator<AgentStreamPart>, DomainError>> {
      onInput?.(input);
      if (!Array.isArray(outcome)) return err(outcome);
      const list = outcome;
      async function* parts(): AsyncGenerator<AgentStreamPart> {
        for (const p of list) yield p;
      }
      return ok(parts());
    },
  };
}

const schemaJson = JSON.stringify(
  {
    title: "Invoice",
    type: "object",
    properties: { total: { type: "number" } },
    required: ["total"],
  },
  null,
  2,
);

describe("response-schema authoring prompt", () => {
  const content =
    typeof RESPONSE_SCHEMA_AUTHORING_PROMPT === "string"
      ? RESPONSE_SCHEMA_AUTHORING_PROMPT
      : RESPONSE_SCHEMA_AUTHORING_PROMPT.content;

  it("is one frozen cacheable system prompt (the gateway prompt-caching shape)", () => {
    expect(typeof RESPONSE_SCHEMA_AUTHORING_PROMPT).toBe("object");
    expect(RESPONSE_SCHEMA_AUTHORING_PROMPT).toHaveProperty("cacheControl", {
      type: "ephemeral",
      ttl: "5m",
    });
  });

  it("gates the first write behind the interview's readiness checklist", () => {
    expect(content).toContain("Do not call write_response_schema until");
    expect(content).toContain("Readiness checklist");
    expect(content).toContain("One concrete valid example.");
    expect(content).toContain("A stated rule for every field.");
    expect(content).toContain("At least one clear reject condition for invalid output.");
  });

  it("anchors the interview on one real filled-in example", () => {
    expect(content).toContain("one real filled-in example");
    expect(content).toContain("never design it in the abstract");
  });

  it("carries the skip conditions, with assumptions stated in chat", () => {
    expect(content).toContain('"just draft it"');
    expect(content).toContain("state those assumptions in chat, never inside the schema");
  });

  it("carries the standard-native artifact rules", () => {
    expect(content).toContain("Do not add secrets");
    expect(content).toContain("Do not create auxiliary documents");
    expect(content).toContain("Do not leave placeholders");
    expect(content).toContain("Do not mention agent.branch, this product");
  });

  it("presses right-sizing during the interview and resists over-constraining", () => {
    expect(content).toContain("building blocks that work together");
    expect(content).toContain("Reject only what the user said should be wrong");
    expect(content).toContain("eval feedback never restarts the interview");
  });

  it("uses approved domain language throughout", () => {
    // "composable" may appear only inside the instruction that bans it —
    // the same shape the skill prompt carries (CONTEXT.md).
    const withoutBanInstruction = content.replace('not "composable"', "");
    expect(withoutBanInstruction).not.toMatch(/\bcomposable\b/i);
    expect(content).not.toMatch(/\bsandbox\b/i);
    expect(content).not.toMatch(/\bharness\b/i);
  });
});

describe("response-schema authoring tools", () => {
  const write = responseSchemaTools.find((tool) => tool.name === "write_response_schema")!;
  const edit = responseSchemaTools.find((tool) => tool.name === "edit_response_schema")!;

  it("accepts a valid JSON Schema document on write", async () => {
    expect(await write.handler({ content: schemaJson })).toEqual({ ok: true, content: schemaJson });
  });

  it("rejects a document that is not valid JSON on write", async () => {
    const result = (await write.handler({ content: "not json" })) as { ok: boolean };
    expect(result.ok).toBe(false);
  });

  it("normalises the edit payload", async () => {
    expect(await edit.handler({ oldStr: "a", newStr: "b" })).toEqual({
      ok: true,
      oldStr: "a",
      newStr: "b",
    });
  });
});

describe("response-schema authoring loop", () => {
  it("yields a single error event when the gateway can't open a stream", async () => {
    const gateway = fakeGateway(domainError("model_unavailable", "No model is configured."));
    const events = await collect(
      runResponseSchemaLoop(
        { messages: [{ role: "user", content: "Schema for my invoices" }] },
        gateway,
        userId,
      ),
    );
    expect(events).toHaveLength(1);
    expect(events[0]!.event).toBe("error");
    expect(events[0]!.data).toHaveProperty("message", "No model is configured.");
  });

  it("maps gateway stream parts to loop events (text, schema write, done)", async () => {
    const gateway = fakeGateway([
      { kind: "text", delta: "Drafting..." },
      { kind: "tool-call", tool: "write_response_schema" },
      { kind: "tool-result", tool: "write_response_schema", output: { ok: true, content: schemaJson } },
      { kind: "finish", finishReason: "stop" },
    ]);

    const events = await collect(
      runResponseSchemaLoop(
        { messages: [{ role: "user", content: "Schema for my invoices" }] },
        gateway,
        userId,
      ),
    );

    expect(events.map((e) => e.event)).toEqual(["text", "tool", "tool", "response-schema", "done"]);
    const schema = events.find((e) => e.event === "response-schema");
    expect(schema?.data).toHaveProperty("source", { document: JSON.parse(schemaJson) });
  });

  it("maps an edit result to a response-schema-edit event", async () => {
    const gateway = fakeGateway([
      { kind: "tool-call", tool: "edit_response_schema" },
      {
        kind: "tool-result",
        tool: "edit_response_schema",
        output: { ok: true, oldStr: '"number"', newStr: '"integer"' },
      },
      { kind: "finish", finishReason: "stop" },
    ]);

    const events = await collect(
      runResponseSchemaLoop(
        { messages: [{ role: "user", content: "Totals are whole cents" }] },
        gateway,
        userId,
      ),
    );

    const editEvent = events.find((e) => e.event === "response-schema-edit");
    expect(editEvent?.data).toEqual({ oldStr: '"number"', newStr: '"integer"' });
  });

  it("opens the stream with the frozen prompt, the tool pair, and an account tag", async () => {
    let input: StreamAgentInput | undefined;
    const gateway = fakeGateway([{ kind: "finish", finishReason: "stop" }], (seen) => {
      input = seen;
    });

    await collect(
      runResponseSchemaLoop(
        { messages: [{ role: "user", content: "Schema for my invoices" }] },
        gateway,
        userId,
      ),
    );

    expect(input?.system).toBe(RESPONSE_SCHEMA_AUTHORING_PROMPT);
    expect(input?.tools.map((tool) => tool.name)).toEqual([
      "write_response_schema",
      "edit_response_schema",
    ]);
    expect(input?.tag).toEqual({ kind: "account", userId, capability: "build" });
    expect(input?.messages.at(-1)).toHaveProperty("cacheControl", { type: "ephemeral" });
  });
});
