import { describe, expect, it } from "vitest";
import {
  LIMIT_MESSAGES,
  MESSAGE_CONTENT_MAX,
  MESSAGES_MAX,
  REQUEST_BYTES_MAX,
  SKILL_BODY_MAX,
  SKILL_DESCRIPTION_MAX,
  SKILL_NAME_MAX,
} from "@/shared";
import { parseBuildRequest } from "./build-request";
import { parseJsonRequest } from "./request-body";
import { parseSkillRequest } from "./skill-request";

function skill(overrides: Partial<{ name: string; description: string; body: string }> = {}) {
  return {
    frontmatter: {
      name: overrides.name ?? "Useful skill",
      description: overrides.description ?? "A skill that does a useful job.",
      extra: {},
    },
    body: overrides.body ?? "Do the thing well.",
  };
}

describe("request validation limits", () => {
  it("accepts skill fields at their limits", () => {
    const parsed = parseSkillRequest({
      skill: skill({
        name: "n".repeat(SKILL_NAME_MAX),
        description: "d".repeat(SKILL_DESCRIPTION_MAX),
        body: "b".repeat(SKILL_BODY_MAX),
      }),
    });

    expect(parsed.ok).toBe(true);
  });

  it("rejects skill fields over their limits with specific copy", () => {
    expect(parseSkillRequest({ skill: skill({ name: "n".repeat(SKILL_NAME_MAX + 1) }) })).toEqual({
      ok: false,
      error: LIMIT_MESSAGES.skillName,
    });
    expect(
      parseSkillRequest({
        skill: skill({ description: "d".repeat(SKILL_DESCRIPTION_MAX + 1) }),
      }),
    ).toEqual({ ok: false, error: LIMIT_MESSAGES.skillDescription });
    expect(parseSkillRequest({ skill: skill({ body: "b".repeat(SKILL_BODY_MAX + 1) }) })).toEqual({
      ok: false,
      error: LIMIT_MESSAGES.skillBody,
    });
  });

  it("accepts build messages at their limits", () => {
    const parsed = parseBuildRequest({
      messages: Array.from({ length: MESSAGES_MAX }, () => ({
        role: "user",
        content: "m".repeat(MESSAGE_CONTENT_MAX),
      })),
    });

    expect(parsed.ok).toBe(true);
  });

  it("rejects build messages over their count and content limits", () => {
    expect(
      parseBuildRequest({
        messages: [{ role: "user", content: "m".repeat(MESSAGE_CONTENT_MAX + 1) }],
      }),
    ).toEqual({ ok: false, error: LIMIT_MESSAGES.messageContent });

    expect(
      parseBuildRequest({
        messages: Array.from({ length: MESSAGES_MAX + 1 }, () => ({
          role: "user",
          content: "hello",
        })),
      }),
    ).toEqual({ ok: false, error: LIMIT_MESSAGES.messages });
  });

  it("rejects oversized content-length before parsing JSON", async () => {
    const request = new Request("https://example.test/api/build", {
      method: "POST",
      headers: { "content-length": String(REQUEST_BYTES_MAX + 1) },
      body: "{}",
    });

    const parsed = await parseJsonRequest(request);

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.response.status).toBe(400);
      await expect(parsed.response.json()).resolves.toEqual({ error: LIMIT_MESSAGES.requestBytes });
    }
  });
});
