import { beforeEach, describe, expect, it, vi } from "vitest";
import { ok, SkillId, UserId } from "@/shared";
import { makeSkill } from "@/modules/skill";
import { POST } from "./route";

const currentIdentity = vi.fn();
const createSkill = vi.fn();

vi.mock("@/server/container", () => ({
  getContainer: () => ({
    auth: { currentIdentity },
    skills: { create: createSkill },
  }),
}));

describe("POST /api/import", () => {
  beforeEach(() => {
    currentIdentity.mockReset();
    createSkill.mockReset();
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
