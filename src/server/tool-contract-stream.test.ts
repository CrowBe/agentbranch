import { describe, it, expect } from "vitest";
import { toolContractLoopResponse } from "./tool-contract-stream";
import { parseToolContract } from "@/modules/tool-contract";
import type { AgentStreamPart, ModelGateway, StreamAgentInput } from "@/modules/model-gateway";
import { domainError, err, ok, unwrap, UserId, type DomainError, type Result } from "@/shared";

const userId = UserId("u1");

function fakeGateway(parts: AgentStreamPart[] | DomainError): ModelGateway {
  return {
    hasModel: true,
    classify: async () => err(domainError("model_unavailable", "n/a")),
    runAgent: async () => err(domainError("model_unavailable", "n/a")),
    generate: async () => err(domainError("model_unavailable", "n/a")),
    async streamAgent(
      _input: StreamAgentInput,
    ): Promise<Result<AsyncGenerator<AgentStreamPart>, DomainError>> {
      if (!Array.isArray(parts)) return err(parts);
      const list = parts;
      async function* stream(): AsyncGenerator<AgentStreamPart> {
        for (const part of list) yield part;
      }
      return ok(stream());
    },
  };
}

async function readEvents(response: Response) {
  const text = await response.text();
  return text
    .trim()
    .split("\n\n")
    .filter(Boolean)
    .map((frame) => {
      const lines = frame.split("\n");
      const event = lines.find((line) => line.startsWith("event: "))!.slice("event: ".length);
      const data = lines.find((line) => line.startsWith("data: "))!.slice("data: ".length);
      return { event, data: JSON.parse(data) as Record<string, unknown> };
    });
}

const completeContract = JSON.stringify(
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

describe("toolContractLoopResponse", () => {
  it("streams the written contract and follows it with lint feedback when findings exist", async () => {
    const incomplete = JSON.stringify({ name: "Bad Name!", description: "short" });
    const response = toolContractLoopResponse(
      { messages: [{ role: "user", content: "Tool for invoice reminders" }] },
      fakeGateway([
        { kind: "tool-result", tool: "write_tool_contract", output: { content: incomplete } },
        { kind: "finish", finishReason: "stop" },
      ]),
      userId,
    );

    const events = await readEvents(response);
    expect(events.map((e) => e.event)).toEqual(["tool", "tool-contract", "lint-feedback", "done"]);
    expect(String(events[2]!.data.feedback)).toContain("tool contract");
  });

  it("applies streamed edits to the current draft and forwards them", async () => {
    const response = toolContractLoopResponse(
      {
        messages: [{ role: "user", content: "Add a failure mode" }],
        current: unwrap(parseToolContract(completeContract)),
      },
      fakeGateway([
        {
          kind: "tool-result",
          tool: "edit_tool_contract",
          output: { oldStr: '"invoice not found"', newStr: '"invoice already paid"' },
        },
        { kind: "finish", finishReason: "stop" },
      ]),
      userId,
    );

    const events = await readEvents(response);
    expect(events.map((e) => e.event)).toEqual(["tool", "tool-contract-edit", "done"]);
  });

  it("surfaces a failed edit as an error event without dropping the stream", async () => {
    const response = toolContractLoopResponse(
      {
        messages: [{ role: "user", content: "Rename a field" }],
        current: unwrap(parseToolContract(completeContract)),
      },
      fakeGateway([
        {
          kind: "tool-result",
          tool: "edit_tool_contract",
          output: { oldStr: "no-such-text", newStr: "x" },
        },
        { kind: "finish", finishReason: "stop" },
      ]),
      userId,
    );

    const events = await readEvents(response);
    expect(events.map((e) => e.event)).toEqual(["tool", "error", "done"]);
    expect(String(events[1]!.data.message)).toContain("not found");
  });

  it("rejects an edit when no draft exists yet", async () => {
    const response = toolContractLoopResponse(
      { messages: [{ role: "user", content: "Change the name" }] },
      fakeGateway([
        {
          kind: "tool-result",
          tool: "edit_tool_contract",
          output: { oldStr: "a", newStr: "b" },
        },
        { kind: "finish", finishReason: "stop" },
      ]),
      userId,
    );

    const events = await readEvents(response);
    expect(events.map((e) => e.event)).toEqual(["tool", "error", "done"]);
    expect(String(events[1]!.data.message)).toContain("No draft exists");
  });

  it("degrades to a single error event when the gateway can't open a stream", async () => {
    const response = toolContractLoopResponse(
      { messages: [{ role: "user", content: "Tool for invoice reminders" }] },
      fakeGateway(domainError("model_unavailable", "No model is configured.")),
      userId,
    );

    const events = await readEvents(response);
    expect(events.map((e) => e.event)).toEqual(["error"]);
  });
});
