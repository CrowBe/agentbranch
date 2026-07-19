import { beforeEach, describe, expect, it, vi } from "vitest";
import { err, ok, SkillId, UserId, SKILL_COUNT_MAX } from "@/shared";
import { makeSkill } from "@/modules/skill";
import { POST } from "./route";

const currentIdentity = vi.fn();
const createSkill = vi.fn();
const listSkills = vi.fn();
const consumeRateLimit = vi.fn();
const fetchSkillMd = vi.fn();

vi.mock("@/server/container", () => ({
  getContainer: () => ({
    auth: { currentIdentity },
    skills: { create: createSkill, listByUser: listSkills },
    requestRateLimiter: { consume: consumeRateLimit },
    skillImportFetcher: { fetchSkillMd },
  }),
}));

describe("POST /api/import", () => {
  beforeEach(() => {
    currentIdentity.mockReset();
    createSkill.mockReset();
    listSkills.mockReset();
    consumeRateLimit.mockReset();
    fetchSkillMd.mockReset();
    listSkills.mockResolvedValue(ok([]));
    consumeRateLimit.mockResolvedValue(ok({ allowed: true }));
  });

  it("fetches and persists a public GitHub SKILL.md URL", async () => {
    currentIdentity.mockResolvedValue(ok({ userId: UserId("user-1"), email: "u@example.test" }));
    fetchSkillMd.mockResolvedValue(ok(
      "---\nname: inbox-triage\ndescription: Sort unread mail into buckets.\n---\n# Steps\nRead mail.",
    ));
    createSkill.mockImplementation(async ({ userId, source }) =>
      ok(makeSkill({
        id: SkillId("skill-1"),
        userId,
        source,
        createdAt: new Date(0),
        updatedAt: new Date(0),
      })),
    );

    const response = await POST(new Request("https://example.test/api/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://github.com/acme/skills/tree/main/inbox" }),
    }));

    expect(response.status).toBe(200);
    expect(fetchSkillMd).toHaveBeenCalledWith("https://github.com/acme/skills/tree/main/inbox");
    expect(createSkill).toHaveBeenCalledWith({
      userId: "user-1",
      source: {
        frontmatter: {
          name: "inbox-triage",
          description: "Sort unread mail into buckets.",
          extra: {},
        },
        body: "# Steps\nRead mail.",
      },
    });
  });

  it("returns a friendly GitHub URL fetch error without persisting", async () => {
    currentIdentity.mockResolvedValue(ok({ userId: UserId("user-1"), email: "u@example.test" }));
    fetchSkillMd.mockResolvedValue(err({
      kind: "invalid_url",
      message: "Import from GitHub URLs only: github.com or raw.githubusercontent.com.",
    }));

    const response = await POST(new Request("https://example.test/api/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://example.test/SKILL.md" }),
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Import from GitHub URLs only: github.com or raw.githubusercontent.com.",
    });
    expect(createSkill).not.toHaveBeenCalled();
  });

  it("parses and persists a pasted SKILL.md for the current user", async () => {
    currentIdentity.mockResolvedValue(ok({ userId: UserId("user-1"), email: "u@example.test" }));
    createSkill.mockImplementation(async ({ userId, source }) =>
      ok(makeSkill({
        id: SkillId("skill-1"),
        userId,
        source,
        createdAt: new Date(0),
        updatedAt: new Date(0),
      })),
    );

    const response = await POST(new Request("https://example.test/api/import", {
      method: "POST",
      body: "---\nname: inbox-triage\ndescription: Sort unread mail into buckets.\n---\n# Steps\nRead mail.",
    }));

    expect(response.status).toBe(200);
    expect(createSkill).toHaveBeenCalledWith({
      userId: "user-1",
      source: {
        frontmatter: {
          name: "inbox-triage",
          description: "Sort unread mail into buckets.",
          extra: {},
        },
        body: "# Steps\nRead mail.",
      },
    });
    await expect(response.json()).resolves.toMatchObject({
      skill: { id: "skill-1", latestRevision: 1 },
      rendered: {
        title: "inbox-triage",
        description: "Sort unread mail into buckets.",
      },
      lint: {
        insights: expect.any(Object),
        breakdown: expect.any(Object),
      },
    });
  });

  it("returns a friendly parse error without persisting", async () => {
    currentIdentity.mockResolvedValue(ok({ userId: UserId("user-1"), email: "u@example.test" }));

    const response = await POST(new Request("https://example.test/api/import", {
      method: "POST",
      body: "not a skill",
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "This doesn't look like a valid SKILL.md yet - Frontmatter is missing a `name`.",
    });
    expect(createSkill).not.toHaveBeenCalled();
  });

  it("rejects a skill over the account cap with friendly cap copy", async () => {
    currentIdentity.mockResolvedValue(ok({ userId: UserId("user-1"), email: "u@example.test" }));
    listSkills.mockResolvedValue(ok(
      Array.from({ length: SKILL_COUNT_MAX }, (_, i) =>
        makeSkill({
          id: SkillId(`existing-${i}`),
          userId: UserId("user-1"),
          source: {
            frontmatter: { name: `existing-${i}`, description: "Existing skill.", extra: {} },
            body: "Existing.",
          },
          createdAt: new Date(0),
          updatedAt: new Date(0),
        }),
      ),
    ));

    const response = await POST(new Request("https://example.test/api/import", {
      method: "POST",
      body: "---\nname: inbox-triage\ndescription: Sort unread mail into buckets.\n---\n# Steps\nRead mail.",
    }));

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({
      error: "You're at your skill limit - delete a skill to make room.",
      code: "cap_reached",
    });
    expect(createSkill).not.toHaveBeenCalled();
  });

  it("rate-limits import requests per user", async () => {
    currentIdentity.mockResolvedValue(ok({ userId: UserId("user-1"), email: "u@example.test" }));
    consumeRateLimit.mockResolvedValue(ok({
      allowed: false,
      reason: "You're going a little fast - give it a few seconds and try again.",
    }));

    const response = await POST(new Request("https://example.test/api/import", {
      method: "POST",
      body: "---\nname: inbox-triage\ndescription: Sort unread mail into buckets.\n---\n# Steps\nRead mail.",
    }));

    expect(response.status).toBe(429);
    expect(consumeRateLimit).toHaveBeenCalledWith(
      "user-1",
      "import",
      { maxRequests: 12, windowMs: 60_000 },
    );
    expect(createSkill).not.toHaveBeenCalled();
  });

  it("rejects oversized payloads before parsing", async () => {
    currentIdentity.mockResolvedValue(ok({ userId: UserId("user-1"), email: "u@example.test" }));

    const response = await POST(new Request("https://example.test/api/import", {
      method: "POST",
      headers: { "content-length": "256001" },
      body: "",
    }));

    expect(response.status).toBe(400);
    expect(createSkill).not.toHaveBeenCalled();
  });
});
