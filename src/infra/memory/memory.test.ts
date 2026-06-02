import { describe, it, expect } from "vitest";
import { createMemorySkillRepository } from "./skill.memory-repository";
import { createMemoryUsageRepository } from "./usage.memory-repository";
import { parseSkillMd } from "@/modules/skill";
import { unwrap, UserId } from "@/shared";

describe("in-memory adapters", () => {
  it("skill repository creates, revises and lists by user", async () => {
    const repo = createMemorySkillRepository();
    const source = unwrap(parseSkillMd(`---\nname: t\ndescription: d\n---\nbody`));
    const created = unwrap(await repo.create({ userId: UserId("u1"), source }));

    const v2 = unwrap(parseSkillMd(`---\nname: t\ndescription: d2\n---\nbody2`));
    const saved = unwrap(await repo.save({ id: created.id, source: v2 }));
    expect(saved.source.frontmatter.description).toBe("d2");
    expect(saved.updatedAt.getTime()).toBeGreaterThanOrEqual(created.createdAt.getTime());

    const mine = unwrap(await repo.listByUser(UserId("u1")));
    expect(mine).toHaveLength(1);
    expect(unwrap(await repo.listByUser(UserId("u2")))).toHaveLength(0);
  });

  it("usage repository accumulates across increments", async () => {
    const repo = createMemoryUsageRepository();
    await repo.increment(UserId("u1"), { tokens: 100, turns: 1 });
    const snap = unwrap(await repo.increment(UserId("u1"), { tokens: 50, turns: 1 }));
    expect(snap.tokensUsed).toBe(150);
    expect(snap.turnsUsed).toBe(2);
  });
});
