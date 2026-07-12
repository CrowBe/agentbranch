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
    expect(events.find((e) => e.event === "skill-checkpoint")?.data.skillId).toBe(done?.data.skillId);
    expect(events.find((e) => e.event === "lint-feedback")?.data.feedback).toContain(
      "Lint - Quality C 67/100",
    );
    const persisted = unwrap(await repo.findById(done!.data.skillId, userId));
    expect(persisted?.source.frontmatter.name).toBe("greeter");
    const versions = unwrap(await repo.listVersions(done!.data.skillId, userId));
    expect(versions).toHaveLength(1);
    expect(versions[0]?.lintSummary).toEqual({
      score: 67,
      grade: "C",
      counts: { error: 0, warn: 2, info: 3 },
      rules: [
        "body.examples.missing",
        "body.negative-scope.missing",
        "body.structure.headings",
        "frontmatter.description.trigger-vocabulary",
        "metadata.category.missing",
      ],
    });
  });

  it("does not emit lint feedback when a written skill is clean", async () => {
    const repo = createMemorySkillRepository();
    const skillMd = `---\nname: calendar-planner\ndescription: Plan calendar meetings from plain language requests.\ncategory: calendar\ntags:\n  - scheduling\n  - meetings\n---\n# Steps\n\n- Review the requested date, time, attendees, and meeting purpose.\n- Check availability before proposing slots.\n\n## When not to use\n\nDo not use for non-calendar requests.\n\n## Example\n\nInput: Find time with Ana tomorrow. Output: Suggested meeting slots with conflicts noted.`;
    const response = buildLoopResponse(
      { messages: [{ role: "user", content: "Make a calendar planner" }] },
      fakeGateway([
        { kind: "tool-result", tool: "write_skill", output: { content: skillMd } },
        { kind: "finish", finishReason: "stop" },
      ]),
      repo,
      userId,
    );

    const events = await readEvents(response);

    expect(events.find((e) => e.event === "lint-feedback")).toBeUndefined();
    expect(events.find((e) => e.event === "done")?.data.skillId).toEqual(expect.any(String));
  });

  it("checkpoints a first draft before the build finishes without cutting a revision", async () => {
    const repo = createMemorySkillRepository();
    const skillMd = `---\nname: greeter\ndescription: Greets people warmly\n---\nSay hello.`;
    const response = buildLoopResponse(
      { messages: [{ role: "user", content: "Make a greeter" }] },
      fakeGateway([
        { kind: "tool-result", tool: "write_skill", output: { content: skillMd } },
      ]),
      repo,
      userId,
    );

    const events = await readEvents(response);
    const checkpoint = events.find((e) => e.event === "skill-checkpoint");

    expect(checkpoint?.data.skillId).toEqual(expect.any(String));
    expect(events.find((e) => e.event === "done")).toBeUndefined();
    const persisted = unwrap(await repo.findById(checkpoint!.data.skillId, userId));
    expect(persisted?.source.frontmatter.name).toBe("greeter");
    expect(persisted?.latestRevision).toBe(0);
    expect(unwrap(await repo.listVersions(checkpoint!.data.skillId, userId))).toHaveLength(0);
  });

  it("streams a cap error instead of persisting a second free-tier skill", async () => {
    const repo = createMemorySkillRepository();
    const source = unwrap(parseSkillMd(`---\nname: existing\ndescription: Existing skill\n---\nBody.`));
    unwrap(await repo.create({ userId, source }));

    const response = buildLoopResponse(
      { messages: [{ role: "user", content: "Make a greeter" }] },
      fakeGateway([
        {
          kind: "tool-result",
          tool: "write_skill",
          output: {
            content: `---\nname: greeter\ndescription: Greets people warmly\n---\nSay hello.`,
          },
        },
        { kind: "finish", finishReason: "stop" },
      ]),
      repo,
      userId,
      async () => "free",
    );

    const events = await readEvents(response);

    expect(events.find((e) => e.event === "error")?.data.message).toBe(
      "You're at your skill limit - delete a skill to make room, or upgrade for more.",
    );
    expect(events.find((e) => e.event === "done")).toBeUndefined();
    expect(unwrap(await repo.listByUser(userId))).toHaveLength(1);
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
    expect(unwrap(await repo.listVersions(created.id, userId))).toHaveLength(2);
  });

  it("saves a completed draft turn to the branch head without moving the main pointer", async () => {
    const repo = createMemorySkillRepository();
    const source = unwrap(parseSkillMd(`---\nname: greeter\ndescription: Greets people warmly\n---\nSay hello.`));
    const created = unwrap(await repo.create({ userId, source }));
    const branch = unwrap(await repo.createBranch({ id: created.id, userId }));
    const mainVersionBefore = created.latestVersionId;

    const response = buildLoopResponse(
      {
        messages: [{ role: "user", content: "Make it warmer" }],
        current: source,
        currentSkillId: created.id,
        branchId: branch.id,
      },
      fakeGateway([
        {
          kind: "tool-result",
          tool: "edit_skill",
          output: { oldStr: "Say hello.", newStr: "Say hello warmly." },
        },
        { kind: "finish", finishReason: "stop" },
      ]),
      repo,
      userId,
    );

    const events = await readEvents(response);
    const done = events.find((e) => e.event === "done");

    // The draft turn is a new revision on the branch (seeded head was revision 1).
    expect(done?.data.skillId).toBe(created.id);
    expect(done?.data.revision).toBe(2);
    // No interim checkpoint touches the skill aggregate during a draft build.
    expect(events.find((e) => e.event === "skill-checkpoint")).toBeUndefined();

    // The blessed main version is untouched until promote.
    const persisted = unwrap(await repo.findById(created.id, userId));
    expect(persisted?.latestVersionId).toBe(mainVersionBefore);
    expect(persisted?.source.body).toBe("Say hello.");

    // The draft head advanced.
    const draftVersions = unwrap(await repo.listBranchVersions(created.id, userId, branch.id));
    expect(draftVersions).toHaveLength(2);
    expect(draftVersions[0]?.source.body).toBe("Say hello warmly.");
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
