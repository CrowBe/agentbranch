import { beforeEach, describe, expect, it, vi } from "vitest";
import { err, ok, SkillId, UserId, SKILL_COUNT_MAX } from "@/shared";
import { makeSkill } from "@/modules/skill";
import { POST } from "./route";

const currentIdentity = vi.fn();
const createSkill = vi.fn();
const listSkills = vi.fn();
const consumeRateLimit = vi.fn();
const fetchSkillMd = vi.fn();
const saveEquipment = vi.fn();

vi.mock("@/server/container", () => ({
  getContainer: () => ({
    auth: { currentIdentity },
    skills: { create: createSkill, listByUser: listSkills },
    requestRateLimiter: { consume: consumeRateLimit },
    skillImportFetcher: { fetchSkillMd },
    equipment: { save: saveEquipment },
  }),
}));

describe("POST /api/import", () => {
  beforeEach(() => {
    currentIdentity.mockReset();
    createSkill.mockReset();
    listSkills.mockReset();
    consumeRateLimit.mockReset();
    fetchSkillMd.mockReset();
    saveEquipment.mockReset();
    listSkills.mockResolvedValue(ok([]));
    consumeRateLimit.mockResolvedValue(ok({ allowed: true }));
    saveEquipment.mockImplementation(async ({ userId, kind, name, document }) =>
      ok({
        id: `equipment-${name}`,
        userId,
        kind,
        name,
        document,
        contentHash: "hash",
        createdAt: new Date(0),
        updatedAt: new Date(0),
      }),
    );
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

  it("lands a tool contract on the primitive rung without touching skills", async () => {
    currentIdentity.mockResolvedValue(ok({ userId: UserId("user-1"), email: "u@example.test" }));

    const response = await POST(new Request("https://example.test/api/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        tier: "primitive",
        document: JSON.stringify({
          name: "fetch_unread_email",
          description: "Fetch unread messages from the inbox.",
          input: { schema: { type: "object", properties: {} } },
          output: { schema: { type: "object", properties: {} } },
        }),
      }),
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      kind: "tool-contract",
      equipment: { kind: "tool-contract", name: "fetch_unread_email" },
    });
    expect(createSkill).not.toHaveBeenCalled();
  });

  it("reports the competing reading when a document is genuinely ambiguous", async () => {
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
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        tier: "primitive",
        document: "---\nname: inbox-triage\ndescription: Sort unread mail into buckets.\n---\nRead mail.",
      }),
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      kind: "skill",
      alternatives: ["subagent-definition"],
    });
  });

  it("honours an explicit kind over the default reading", async () => {
    currentIdentity.mockResolvedValue(ok({ userId: UserId("user-1"), email: "u@example.test" }));

    const response = await POST(new Request("https://example.test/api/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        tier: "primitive",
        kind: "subagent-definition",
        document: "---\nname: inbox-triage\ndescription: Sort unread mail into buckets.\n---\nRead mail.",
      }),
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ kind: "subagent-definition" });
    expect(createSkill).not.toHaveBeenCalled();
  });

  it("lands a related set and reports the ones it could not read", async () => {
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
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        tier: "related-primitives",
        documents: [
          { document: "---\nname: inbox-triage\ndescription: Sort unread mail.\n---\nRead mail.", kind: "skill" },
          {
            document: JSON.stringify({
              name: "fetch_unread_email",
              description: "Fetch unread messages.",
              input: { schema: { type: "object", properties: {} } },
              output: { schema: { type: "object", properties: {} } },
            }),
          },
          { document: "definitely not a document" },
        ],
      }),
    }));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.tier).toBe("related-primitives");
    expect(body.imported.map((item: { kind: string }) => item.kind)).toEqual([
      "skill",
      "tool-contract",
    ]);
    expect(body.skipped).toHaveLength(1);
  });

  it("fails a related set only when nothing in it could be read", async () => {
    currentIdentity.mockResolvedValue(ok({ userId: UserId("user-1"), email: "u@example.test" }));

    const response = await POST(new Request("https://example.test/api/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        tier: "related-primitives",
        documents: [{ document: "nope" }, { document: "also nope" }],
      }),
    }));

    expect(response.status).toBe(400);
    expect(createSkill).not.toHaveBeenCalled();
    expect(saveEquipment).not.toHaveBeenCalled();
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
