import { describe, expect, it } from "vitest";
import { metadataSuggestCapability } from "./index";
import { runCapability } from "@/modules/skill-analysis";
import { makeSkill, parseSkillMd, type Skill } from "@/modules/skill";
import type { ModelGateway } from "@/modules/model-gateway";
import { ok, unwrap, SkillId, UserId } from "@/shared";

function fixtureSkill(): Skill {
  const source = unwrap(
    parseSkillMd(
      `---\nname: inbox-triage\ndescription: Triage unread email into reply, delegate, or archive.\ntags:\n  - triage\n---\n\n## When to use\nSort unread email in the inbox by urgency and draft replies.\n`,
    ),
  );
  return makeSkill({
    id: SkillId("s1"),
    userId: UserId("u1"),
    source,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  });
}

describe("metadata-suggest capability", () => {
  it("uses the model's recommendation when a gateway is supplied", async () => {
    const view = unwrap(
      await runCapability(metadataSuggestCapability, "suggestions", fixtureSkill(), {
        gateway: fakeGateway(),
        tag: { kind: "account", userId: UserId("u1"), capability: "metadata-suggest" },
      }),
    );

    expect(view.category).toBe("email");
    expect(view.name).toBe("inbox-triage");
    expect(view.description).toContain("unread email");
    expect(view.tags).toEqual(["triage", "inbox-zero"]);
    expect(view.rationale).toContain("email");
    expect(view.current).toEqual({ category: null, tags: ["triage"] });
  });

  it("falls back to the deterministic keyword scorer offline", async () => {
    const view = unwrap(
      await runCapability(metadataSuggestCapability, "suggestions", fixtureSkill(), {
        gateway: offlineGateway(),
      }),
    );

    expect(view.category).toBe("email");
    expect(view.tags.length).toBeGreaterThan(0);
    expect(view.tags.every((tag) => /^[a-z0-9][a-z0-9-]*$/.test(tag))).toBe(true);
    expect(view.current.tags).toEqual(["triage"]);
  });

  it("suggests no category rather than guessing when nothing fits", async () => {
    const source = unwrap(
      parseSkillMd(`---\nname: mystery\ndescription: Ponder the imponderable.\n---\n\nBe wise.\n`),
    );
    const skill = makeSkill({
      id: SkillId("s2"),
      userId: UserId("u1"),
      source,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    });

    const view = unwrap(await runCapability(metadataSuggestCapability, "suggestions", skill));
    expect(view.category).toBeNull();
  });
});

function fakeGateway(): ModelGateway {
  return {
    hasModel: true,
    async classify() {
      return ok({ choice: null, rationale: "n/a" });
    },
    async runAgent() {
      return ok({ transcript: [] });
    },
    async streamAgent() {
      async function* empty() {}
      return ok(empty());
    },
    async generate({ schema }) {
      return ok(
        schema.parse({
          name: "inbox-triage",
          description: "Triage unread email into reply, delegate, or archive.",
          category: "email",
          tags: ["triage", "Inbox Zero"],
          rationale: "The skill sorts unread email.",
        }),
      );
    },
  };
}

function offlineGateway(): ModelGateway {
  return { ...fakeGateway(), hasModel: false };
}
