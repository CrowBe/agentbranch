import { beforeEach, describe, expect, it, vi } from "vitest";
import { ok, UserId } from "@/shared";
import { POST } from "./route";

const currentIdentity = vi.fn();

vi.mock("@/server/container", () => ({
  getContainer: () => ({
    auth: { currentIdentity },
  }),
}));

const DOCUMENT = JSON.stringify({
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
  safetyNotes: ["Sends outbound email."],
});

function contractRequest(body: unknown): Request {
  return new Request("https://example.test/api/tool-contract", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/tool-contract", () => {
  beforeEach(() => {
    currentIdentity.mockReset();
  });

  it("returns friendly insights by default", async () => {
    currentIdentity.mockResolvedValue(ok({ userId: UserId("user-1") }));

    const response = await POST(contractRequest({ document: DOCUMENT }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      score: expect.any(Number),
      grade: expect.any(String),
      summary: expect.stringContaining("tool contract"),
    });
  });

  it("returns the detailed breakdown when requested", async () => {
    currentIdentity.mockResolvedValue(ok({ userId: UserId("user-1") }));

    const response = await POST(contractRequest({ document: DOCUMENT, surface: "breakdown" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      summary: { counts: { error: 0 } },
      findings: expect.any(Array),
    });
  });

  it("rejects a structurally invalid contract with the parse message", async () => {
    currentIdentity.mockResolvedValue(ok({ userId: UserId("user-1") }));

    const response = await POST(contractRequest({ document: JSON.stringify({ name: "t" }) }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "The tool contract is missing a `description`.",
    });
  });

  it("requires a signed-in user", async () => {
    currentIdentity.mockResolvedValue(ok(null));

    const response = await POST(contractRequest({ document: DOCUMENT }));

    expect(response.status).toBe(401);
  });
});
