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
  title: "invoice-summary",
  description: "Summary of one invoice.",
  type: "object",
  required: ["invoiceId"],
  properties: { invoiceId: { type: "string", description: "The invoice id." } },
});

function schemaRequest(body: unknown): Request {
  return new Request("https://example.test/api/response-schema", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/response-schema", () => {
  beforeEach(() => {
    currentIdentity.mockReset();
  });

  it("returns friendly insights by default", async () => {
    currentIdentity.mockResolvedValue(ok({ userId: UserId("user-1") }));

    const response = await POST(schemaRequest({ document: DOCUMENT }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      score: expect.any(Number),
      grade: expect.any(String),
      summary: expect.stringContaining("response schema"),
    });
  });

  it("returns the detailed breakdown when requested", async () => {
    currentIdentity.mockResolvedValue(ok({ userId: UserId("user-1") }));

    const response = await POST(schemaRequest({ document: DOCUMENT, surface: "breakdown" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      summary: { counts: { error: 0 } },
      findings: expect.any(Array),
    });
  });

  it("rejects a document that is not JSON", async () => {
    currentIdentity.mockResolvedValue(ok({ userId: UserId("user-1") }));

    const response = await POST(schemaRequest({ document: "{nope" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Could not parse the response schema as JSON.",
    });
  });

  it("requires a signed-in user", async () => {
    currentIdentity.mockResolvedValue(ok(null));

    const response = await POST(schemaRequest({ document: DOCUMENT }));

    expect(response.status).toBe(401);
  });
});
