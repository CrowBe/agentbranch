import { describe, it, expect } from "vitest";
import { createMemoryEvalRunRepository } from "./eval.memory-repository";
import { createMemorySkillRepository } from "./skill.memory-repository";
import { createMemoryTestRunRepository } from "./test-run.memory-repository";
import { createMemoryUsageRepository } from "./usage.memory-repository";
import { parseSkillMd } from "@/modules/skill";
import { unwrap, UserId } from "@/shared";

describe("in-memory adapters", () => {
  it("skill repository creates, revises and lists by user", async () => {
    const repo = createMemorySkillRepository();
    const source = unwrap(parseSkillMd(`---\nname: t\ndescription: d\n---\nbody`));
    const created = unwrap(await repo.create({ userId: UserId("u1"), source }));

    const v2 = unwrap(parseSkillMd(`---\nname: t\ndescription: d2\n---\nbody2`));
    const saved = unwrap(await repo.save({ id: created.id, userId: created.userId, source: v2 }));
    expect(saved.source.frontmatter.description).toBe("d2");
    expect(created.latestRevision).toBe(1);
    expect(saved.latestRevision).toBe(2);
    expect(saved.updatedAt.getTime()).toBeGreaterThanOrEqual(created.createdAt.getTime());

    const mine = unwrap(await repo.listByUser(UserId("u1")));
    expect(mine).toHaveLength(1);
    expect(unwrap(await repo.listByUser(UserId("u2")))).toHaveLength(0);
    expect(unwrap(await repo.findById(created.id, UserId("u2")))).toBeNull();
  });

  it("deletes skills only for their owner", async () => {
    const repo = createMemorySkillRepository();
    const source = unwrap(parseSkillMd(`---\nname: t\ndescription: d\n---\nbody`));
    const created = unwrap(await repo.create({ userId: UserId("u1"), source }));

    const blocked = await repo.delete(created.id, UserId("u2"));

    expect(blocked).toMatchObject({ ok: false, error: { tag: "not_found" } });
    expect(unwrap(await repo.findById(created.id, UserId("u1")))).not.toBeNull();

    unwrap(await repo.delete(created.id, UserId("u1")));
    expect(unwrap(await repo.findById(created.id, UserId("u1")))).toBeNull();
    expect(unwrap(await repo.listByUser(UserId("u1")))).toHaveLength(0);
  });

  it("keeps run records pinned to the evaluated skill version after later edits", async () => {
    const skills = createMemorySkillRepository();
    const testRuns = createMemoryTestRunRepository();
    const evalRuns = createMemoryEvalRunRepository();
    const v1 = unwrap(parseSkillMd(`---\nname: t\ndescription: d\n---\nbody`));
    const created = unwrap(await skills.create({ userId: UserId("u1"), source: v1 }));

    const testRun = unwrap(
      await testRuns.record({
        userId: created.userId,
        skillId: created.id,
        skillVersionId: created.latestVersionId ?? null,
        status: "completed",
        scenario: { prompt: "Run it.", seedData: {} },
        transcript: [{ kind: "model", text: "done" }],
      }),
    );
    const evalRun = unwrap(
      await evalRuns.record({
        userId: created.userId,
        skillId: created.id,
        skillVersionId: created.latestVersionId ?? null,
        status: "passed",
        result: {
          kind: "triggering-eval",
          passed: true,
          cases: [],
          insight: { verdict: "good", summary: "ok", findings: [], watch: [] },
        },
      }),
    );

    expect(unwrap(await testRuns.findById(testRun.id, UserId("u2")))).toBeNull();
    expect(unwrap(await evalRuns.findById(evalRun.id, UserId("u2")))).toBeNull();

    const v2 = unwrap(parseSkillMd(`---\nname: t\ndescription: d2\n---\nbody2`));
    const saved = unwrap(await skills.save({ id: created.id, userId: created.userId, source: v2 }));

    expect(testRun.skillVersionId).toBe(created.latestVersionId);
    expect(evalRun.skillVersionId).toBe(created.latestVersionId);
    expect(saved.latestVersionId).not.toBe(created.latestVersionId);
  });

  it("usage repository accumulates across increments", async () => {
    const repo = createMemoryUsageRepository();
    await repo.increment(UserId("u1"), {
      usage: {
        inputTokens: 70,
        outputTokens: 20,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 10,
      },
      turns: 1,
    });
    const snap = unwrap(
      await repo.increment(UserId("u1"), {
        usage: {
          inputTokens: 25,
          outputTokens: 25,
          cacheReadInputTokens: 50,
          cacheCreationInputTokens: 0,
        },
        turns: 1,
      }),
    );
    expect(snap.tokensUsed).toBe(200);
    expect(snap.turnsUsed).toBe(2);
    expect(snap.inputTokensUsed).toBe(95);
    expect(snap.outputTokensUsed).toBe(45);
    expect(snap.cacheReadInputTokensUsed).toBe(50);
    expect(snap.cacheCreationInputTokensUsed).toBe(10);
  });
});
