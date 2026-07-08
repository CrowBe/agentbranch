import { describe, it, expect } from "vitest";
import { responseSchemaLoopResponse } from "./response-schema-stream";
import { parseResponseSchema } from "@/modules/response-schema";
import type {
  AgentStreamPart,
  ModelGateway,
  StreamAgentInput,
} from "@/modules/model-gateway";
import {
  domainError,
  err,
  ok,
  unwrap,
  UserId,
  type DomainError,
  type Result,
} from "@/shared";

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

const titledSchema = JSON.stringify(
  {
    title: "invoice-summary",
    description: "The structured summary a billing skill returns for one invoice.",
    type: "object",
    additionalProperties: false,
    required: ["amount"],
    properties: { amount: { type: "number", description: "Total due in cents." } },
  },
  null,
  2,
);

describe("responseSchemaLoopResponse", () => {
  it("streams the written schema and follows it with lint feedback when findings exist", async () => {
    const untitled = JSON.stringify({ type: "object" });
    const response = responseSchemaLoopResponse(
      { messages: [{ role: "user", content: "Schema for my invoices" }] },
      fakeGateway([
        { kind: "tool-result", tool: "write_response_schema", output: { content: untitled } },
        { kind: "finish", finishReason: "stop" },
      ]),
      userId,
    );

    const events = await readEvents(response);
    expect(events.map((e) => e.event)).toEqual(["tool", "response-schema", "lint-feedback", "done"]);
    expect(String(events[2]!.data.feedback)).toContain("response schema");
  });

  it("applies streamed edits to the current draft and forwards them", async () => {
    const response = responseSchemaLoopResponse(
      {
        messages: [{ role: "user", content: "Totals are whole cents" }],
        current: unwrap(parseResponseSchema(titledSchema)),
      },
      fakeGateway([
        {
          kind: "tool-result",
          tool: "edit_response_schema",
          output: { oldStr: '"type": "number"', newStr: '"type": "integer"' },
        },
        { kind: "finish", finishReason: "stop" },
      ]),
      userId,
    );

    const events = await readEvents(response);
    expect(events.map((e) => e.event)).toEqual(["tool", "response-schema-edit", "done"]);
  });

  it("surfaces a failed edit as an error event without dropping the stream", async () => {
    const response = responseSchemaLoopResponse(
      {
        messages: [{ role: "user", content: "Rename the field" }],
        current: unwrap(parseResponseSchema(titledSchema)),
      },
      fakeGateway([
        {
          kind: "tool-result",
          tool: "edit_response_schema",
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
    const response = responseSchemaLoopResponse(
      { messages: [{ role: "user", content: "Change the title" }] },
      fakeGateway([
        {
          kind: "tool-result",
          tool: "edit_response_schema",
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
    const response = responseSchemaLoopResponse(
      { messages: [{ role: "user", content: "Schema for my invoices" }] },
      fakeGateway(domainError("model_unavailable", "No model is configured.")),
      userId,
    );

    const events = await readEvents(response);
    expect(events.map((e) => e.event)).toEqual(["error"]);
  });
});
