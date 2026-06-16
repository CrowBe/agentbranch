import { beforeEach, describe, expect, it, vi } from "vitest";
import { ok, UserId } from "@/shared";
import { POST } from "./route";

const currentIdentity = vi.fn();

vi.mock("@/server/container", () => ({
  getContainer: () => ({
    auth: { currentIdentity },
  }),
}));

function skill(overrides: Partial<{ name: string; description: string; body: string }> = {}) {
  return {
    frontmatter: {
      name: overrides.name ?? "inbox-triage",
      description: overrides.description ?? "Sort unread mail into useful buckets.",
      extra: {},
    },
    body: overrides.body ?? "# Steps\nRead mail and sort it.",
  };
}

function lintRequest(body: unknown): Request {
  return new Request("https://example.test/api/lint", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/lint", () => {
  beforeEach(() => {
    currentIdentity.mockReset();
  });

  it("returns friendly insights by default", async () => {
    currentIdentity.mockResolvedValue(ok({ userId: UserId("user-1") }));

    const response = await POST(lintRequest({ skill: skill() }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      score: expect.any(Number),
      grade: expect.any(String),
      summary: expect.any(String),
      findings: expect.any(Array),
      watch: expect.any(Array),
    });
  });

  it("returns detailed breakdown when requested", async () => {
    currentIdentity.mockResolvedValue(ok({ userId: UserId("user-1") }));

    const response = await POST(lintRequest({
      skill: skill({ name: "Inbox Triage" }),
      surface: "breakdown",
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      summary: {
        score: expect.any(Number),
        grade: expect.any(String),
        counts: {
          error: expect.any(Number),
          warn: expect.any(Number),
          info: expect.any(Number),
        },
      },
      findings: expect.arrayContaining([
        expect.objectContaining({
          rule: "frontmatter.name.format",
          severity: "warn",
        }),
      ]),
    });
  });

  it("rejects invalid surfaces", async () => {
    currentIdentity.mockResolvedValue(ok({ userId: UserId("user-1") }));

    const response = await POST(lintRequest({ skill: skill(), surface: "raw" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid request body." });
  });

  it("requires a signed-in user", async () => {
    currentIdentity.mockResolvedValue(ok(null));

    const response = await POST(lintRequest({ skill: skill() }));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Sign in to lint a skill." });
  });
});
