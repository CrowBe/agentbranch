import { beforeEach, describe, expect, it, vi } from "vitest";
import { domainError, err, ok, UserId } from "@/shared";
import type { AgentStreamPart, StreamAgentInput } from "@/modules/model-gateway";
import { POST } from "./route";

const currentIdentity = vi.fn();
const streamAgent = vi.fn();

vi.mock("@/server/container", () => ({
  getContainer: () => ({
    auth: { currentIdentity },
    modelGateway: {
      hasModel: true,
      classify: vi.fn(),
      runAgent: vi.fn(),
      generate: vi.fn(),
      streamAgent,
    },
  }),
}));

const DOCUMENT = JSON.stringify({
  title: "invoice-summary",
  description: "Summary of one invoice.",
  type: "object",
  required: ["invoiceId"],
  properties: { invoiceId: { type: "string", description: "The invoice id." } },
});

function buildRequest(body: unknown): Request {
  return new Request("https://example.test/api/response-schema/build", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/response-schema/build", () => {
  beforeEach(() => {
    currentIdentity.mockReset();
    streamAgent.mockReset();
  });

  it("streams authoring events as SSE through the gateway", async () => {
    currentIdentity.mockResolvedValue(ok({ userId: UserId("user-1") }));
    streamAgent.mockImplementation(async (input: StreamAgentInput) => {
      expect(input.tag).toEqual({ kind: "account", userId: UserId("user-1"), capability: "build" });
      async function* parts(): AsyncGenerator<AgentStreamPart> {
        yield { kind: "text", delta: "Let me ask two questions." };
        yield { kind: "finish", finishReason: "stop" };
      }
      return ok(parts());
    });

    const response = await POST(
      buildRequest({ messages: [{ role: "user", content: "Schema for my invoices" }] }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const text = await response.text();
    expect(text).toContain("event: text");
    expect(text).toContain("event: done");
  });

  it("parses the current draft through the source model and rejects bad JSON", async () => {
    currentIdentity.mockResolvedValue(ok({ userId: UserId("user-1") }));

    const response = await POST(
      buildRequest({
        messages: [{ role: "user", content: "Rename the field" }],
        current: "{nope",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Could not parse the response schema as JSON.",
    });
  });

  it("accepts a valid current draft", async () => {
    currentIdentity.mockResolvedValue(ok({ userId: UserId("user-1") }));
    streamAgent.mockResolvedValue(err(domainError("model_unavailable", "No model is configured.")));

    const response = await POST(
      buildRequest({
        messages: [{ role: "user", content: "Rename the field" }],
        current: DOCUMENT,
      }),
    );

    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain("event: error");
    expect(text).toContain("No model is configured.");
  });

  it("rejects an empty conversation", async () => {
    currentIdentity.mockResolvedValue(ok({ userId: UserId("user-1") }));

    const response = await POST(buildRequest({ messages: [] }));

    expect(response.status).toBe(400);
  });

  it("requires a signed-in user", async () => {
    currentIdentity.mockResolvedValue(ok(null));

    const response = await POST(
      buildRequest({ messages: [{ role: "user", content: "Schema for my invoices" }] }),
    );

    expect(response.status).toBe(401);
  });
});
