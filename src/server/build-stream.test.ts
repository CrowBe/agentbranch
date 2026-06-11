import { describe, it, expect } from "vitest";
import { buildLoopResponse } from "./build-stream";
import { createMemorySkillRepository } from "@/infra/memory/skill.memory-repository";
import { parseSkillMd } from "@/modules/skill";
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

function fakeGateway(parts: readonly AgentStreamPart[]): ModelGateway {
  return {
    hasModel: true,
    classify: async () => err(domainError("model_unavailable", "n/a")),
    runAgent: async () => err(domainError("model_unavailable", "n/a")),
    generate: async () => err(domainError("model_unavailable", "n/a")),
    async streamAgent(
      _input: StreamAgentInput,
    ): Promise<Result<AsyncGenerator<AgentStreamPart>, DomainError>> {
      async function* stream(): AsyncGenerator<AgentStreamPart> {
        for (const part of parts) yield part;
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
      return { event, data: JSON.parse(data) };
    });
}

describe("buildLoopResponse", () => {
  it("persists a completed first draft and returns its skill id and revision", async () => {
    const repo = createMemorySkillRepository();
    const skillMd = `---\nname: greeter\ndescription: Greets people warmly\n---\nSay hello.`;
    const response = buildLoopResponse(
      { messages: [{ role: "user", content: "Make a greeter" }] },
      fakeGateway([
        { kind: "tool-result", tool: "write_skill", output: { content: skillMd } },
        { kind: "finish", finishReason: "stop" },
      ]),
      repo,
      userId,
    );

    const events = await readEvents(response);
    const done = events.find((e) => e.event === "done");

    expect(done?.data.skillId).toEqual(expect.any(String));
    expect(done?.data.revision).toBe(1);
    const persisted = unwrap(await repo.findById(done!.data.skillId, userId));
    expect(persisted?.source.frontmatter.name).toBe("greeter");
  });

  it("saves an edit turn as the next revision of the existing skill", async () => {
    const repo = createMemorySkillRepository();
    const source = unwrap(parseSkillMd(`---\nname: greeter\ndescription: Greets people warmly\n---\nSay hello.`));
    const created = unwrap(await repo.create({ userId, source }));

    const response = buildLoopResponse(
      {
        messages: [{ role: "user", content: "Make it concise" }],
        current: source,
        currentSkillId: created.id,
      },
      fakeGateway([
        {
          kind: "tool-result",
          tool: "edit_skill",
          output: { oldStr: "Say hello.", newStr: "Say hello in one sentence." },
        },
        { kind: "finish", finishReason: "stop" },
      ]),
      repo,
      userId,
    );

    const events = await readEvents(response);
    const done = events.find((e) => e.event === "done");
    const persisted = unwrap(await repo.findById(created.id, userId));

    expect(done?.data.skillId).toBe(created.id);
    expect(done?.data.revision).toBe(2);
    expect(persisted?.source.body).toBe("Say hello in one sentence.");
  });

  it("streams an error and does not persist when an edit cannot be applied", async () => {
    const repo = createMemorySkillRepository();
    const source = unwrap(parseSkillMd(`---\nname: greeter\ndescription: Greets people warmly\n---\nSay hello.`));
    const created = unwrap(await repo.create({ userId, source }));

    const response = buildLoopResponse(
      {
        messages: [{ role: "user", content: "Make it concise" }],
        current: source,
        currentSkillId: created.id,
      },
      fakeGateway([
        {
          kind: "tool-result",
          tool: "edit_skill",
          output: { oldStr: "Missing text.", newStr: "Hi." },
        },
        { kind: "finish", finishReason: "stop" },
      ]),
      repo,
      userId,
    );

    const events = await readEvents(response);
    const persisted = unwrap(await repo.findById(created.id, userId));

    expect(events.find((e) => e.event === "error")?.data.message).toContain("target text was not found");
    expect(events.find((e) => e.event === "skill-edit")).toBeUndefined();
    expect(persisted?.source.body).toBe("Say hello.");
  });

  it("does not revise another user's skill", async () => {
    const repo = createMemorySkillRepository();
    const source = unwrap(parseSkillMd(`---\nname: greeter\ndescription: Greets people warmly\n---\nSay hello.`));
    const created = unwrap(await repo.create({ userId: UserId("u2"), source }));

    const response = buildLoopResponse(
      {
        messages: [{ role: "user", content: "Make it terse" }],
        current: source,
        currentSkillId: created.id,
      },
      fakeGateway([
        {
          kind: "tool-result",
          tool: "edit_skill",
          output: { oldStr: "Say hello.", newStr: "Hi." },
        },
        { kind: "finish", finishReason: "stop" },
      ]),
      repo,
      userId,
    );

    const events = await readEvents(response);
    const persisted = unwrap(await repo.findById(created.id, UserId("u2")));

    expect(events.find((e) => e.event === "error")?.data.message).toBe("Skill not found.");
    expect(events.find((e) => e.event === "done")).toBeUndefined();
    expect(persisted?.source.body).toBe("Say hello.");
    expect(persisted?.latestRevision).toBe(1);
  });
});
