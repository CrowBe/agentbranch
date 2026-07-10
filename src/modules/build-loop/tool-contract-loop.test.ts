import { describe, it, expect } from "vitest";
import { runToolContractLoop, type ToolContractLoopEvent } from "./tool-contract-loop";
import { TOOL_CONTRACT_AUTHORING_PROMPT } from "./tool-contract-prompt";
import { toolContractTools } from "./tool-contract-tools";
import type { AgentStreamPart, ModelGateway, StreamAgentInput } from "@/modules/model-gateway";
import { ok, err, domainError, UserId, type Result, type DomainError } from "@/shared";

const userId = UserId("u1");

async function collect(gen: AsyncGenerator<ToolContractLoopEvent>): Promise<ToolContractLoopEvent[]> {
  const out: ToolContractLoopEvent[] = [];
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

const contractJson = JSON.stringify(
  {
    name: "send_invoice_reminder",
    description: "Send a payment reminder email for one overdue invoice.",
    input: {
      type: "object",
      required: ["invoiceId"],
      properties: { invoiceId: { type: "string", description: "The invoice id." } },
    },
    output: { $ref: "invoice-summary" },
    examples: [{ input: { invoiceId: "INV-1" } }],
    failureModes: ["invoice not found"],
    safetyNotes: ["Confirm before sending email."],
  },
  null,
  2,
);

describe("tool-contract authoring prompt", () => {
  const content =
    typeof TOOL_CONTRACT_AUTHORING_PROMPT === "string"
      ? TOOL_CONTRACT_AUTHORING_PROMPT
      : TOOL_CONTRACT_AUTHORING_PROMPT.content;

  it("is one frozen cacheable system prompt", () => {
    expect(typeof TOOL_CONTRACT_AUTHORING_PROMPT).toBe("object");
    expect(TOOL_CONTRACT_AUTHORING_PROMPT).toHaveProperty("cacheControl", {
      type: "ephemeral",
      ttl: "5m",
    });
  });

  it("gates the first write behind the interview readiness checklist", () => {
    expect(content).toContain("Do not call write_tool_contract until");
    expect(content).toContain("Readiness checklist");
    expect(content).toContain("A happy path with concrete input and output examples.");
    expect(content).toContain("At least one named failure mode.");
    expect(content).toContain("The confirmation boundary");
  });

  it("anchors the interview on tool inputs, outputs, failures, and safety", () => {
    expect(content).toContain("what the tool does in one sentence");
    expect(content).toContain("what the caller hands the tool");
    expect(content).toContain("what comes back on the happy path");
    expect(content).toContain("what needs confirmation");
  });

  it("uses approved domain language throughout", () => {
    const withoutBanInstruction = content.replace('not "composable"', "");
    expect(withoutBanInstruction).not.toMatch(/\bcomposable\b/i);
    expect(content).not.toMatch(/\bsandbox\b/i);
    expect(content).not.toMatch(/\bharness\b/i);
  });
});

describe("tool-contract authoring tools", () => {
  const write = toolContractTools.find((tool) => tool.name === "write_tool_contract")!;
  const edit = toolContractTools.find((tool) => tool.name === "edit_tool_contract")!;

  it("accepts a valid tool contract on write", async () => {
    expect(await write.handler({ content: contractJson })).toEqual({
      ok: true,
      content: contractJson,
    });
  });

  it("rejects a contract that is not valid JSON", async () => {
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

describe("tool-contract authoring loop", () => {
  it("yields a single error event when the gateway can't open a stream", async () => {
    const gateway = fakeGateway(domainError("model_unavailable", "No model is configured."));
    const events = await collect(
      runToolContractLoop(
        { messages: [{ role: "user", content: "Tool for invoice reminders" }] },
        gateway,
        userId,
      ),
    );
    expect(events).toHaveLength(1);
    expect(events[0]!.event).toBe("error");
    expect(events[0]!.data).toHaveProperty("message", "No model is configured.");
  });

  it("maps gateway stream parts to loop events", async () => {
    const gateway = fakeGateway([
      { kind: "text", delta: "Drafting..." },
      { kind: "tool-call", tool: "write_tool_contract" },
      { kind: "tool-result", tool: "write_tool_contract", output: { ok: true, content: contractJson } },
      { kind: "finish", finishReason: "stop" },
    ]);

    const events = await collect(
      runToolContractLoop(
        { messages: [{ role: "user", content: "Tool for invoice reminders" }] },
        gateway,
        userId,
      ),
    );

    expect(events.map((e) => e.event)).toEqual(["text", "tool", "tool", "tool-contract", "done"]);
    const contract = events.find((e) => e.event === "tool-contract");
    expect(contract?.data).toHaveProperty("source.name", "send_invoice_reminder");
  });

  it("maps an edit result to a tool-contract-edit event", async () => {
    const gateway = fakeGateway([
      { kind: "tool-call", tool: "edit_tool_contract" },
      {
        kind: "tool-result",
        tool: "edit_tool_contract",
        output: { ok: true, oldStr: '"invoice not found"', newStr: '"invoice already paid"' },
      },
      { kind: "finish", finishReason: "stop" },
    ]);

    const events = await collect(
      runToolContractLoop(
        { messages: [{ role: "user", content: "Add a paid invoice failure" }] },
        gateway,
        userId,
      ),
    );

    const editEvent = events.find((e) => e.event === "tool-contract-edit");
    expect(editEvent?.data).toEqual({
      oldStr: '"invoice not found"',
      newStr: '"invoice already paid"',
    });
  });

  it("opens the stream with the frozen prompt, tool pair, and account tag", async () => {
    let input: StreamAgentInput | undefined;
    const gateway = fakeGateway([{ kind: "finish", finishReason: "stop" }], (seen) => {
      input = seen;
    });

    await collect(
      runToolContractLoop(
        { messages: [{ role: "user", content: "Tool for invoice reminders" }] },
        gateway,
        userId,
      ),
    );

    expect(input?.system).toBe(TOOL_CONTRACT_AUTHORING_PROMPT);
    expect(input?.tools.map((tool) => tool.name)).toEqual([
      "write_tool_contract",
      "edit_tool_contract",
    ]);
    expect(input?.tag).toEqual({ kind: "account", userId, capability: "build" });
    expect(input?.messages.at(-1)).toHaveProperty("cacheControl", { type: "ephemeral" });
  });
});
