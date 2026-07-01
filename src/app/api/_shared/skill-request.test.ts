import { describe, expect, it } from "vitest";
import { createMemorySkillRepository } from "@/infra/memory/skill.memory-repository";
import { parseSkillMd } from "@/modules/skill";
import { unwrap, UserId } from "@/shared";
import { parseSkillRequest, resolvePinnedVersionId } from "./skill-request";

const userId = UserId("user-1");

function parse(body: unknown) {
  const parsed = parseSkillRequest(body);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
}

describe("resolvePinnedVersionId", () => {
  it("pins a draft evaluation to the draft head, not the main version", async () => {
    const repo = createMemorySkillRepository();
    const source = unwrap(parseSkillMd(`---\nname: greeter\ndescription: Greets people.\n---\nSay hello.`));
    const created = unwrap(await repo.create({ userId, source }));
    const branch = unwrap(await repo.createBranch({ id: created.id, userId }));
    const edited = unwrap(parseSkillMd(`---\nname: greeter\ndescription: Greets people.\n---\nSay hello warmly.`));
    const draftHead = unwrap(
      await repo.saveToBranch({ id: created.id, userId, branchId: branch.id, source: edited }),
    );

    const pinned = unwrap(
      await resolvePinnedVersionId(
        repo,
        parse({ skill: edited, currentSkillId: created.id, branchId: branch.id }),
        userId,
      ),
    );

    expect(pinned).toBe(draftHead.id);
    expect(pinned).not.toBe(created.latestVersionId);
  });

  it("pins to the main version when no draft is named", async () => {
    const repo = createMemorySkillRepository();
    const source = unwrap(parseSkillMd(`---\nname: greeter\ndescription: Greets people.\n---\nSay hello.`));
    const created = unwrap(await repo.create({ userId, source }));

    const pinned = unwrap(
      await resolvePinnedVersionId(repo, parse({ skill: source, currentSkillId: created.id }), userId),
    );

    expect(pinned).toBe(created.latestVersionId);
  });

  it("records with a null pin when the evaluated source drifts from the draft head", async () => {
    const repo = createMemorySkillRepository();
    const source = unwrap(parseSkillMd(`---\nname: greeter\ndescription: Greets people.\n---\nSay hello.`));
    const created = unwrap(await repo.create({ userId, source }));
    const branch = unwrap(await repo.createBranch({ id: created.id, userId }));
    const drifted = unwrap(parseSkillMd(`---\nname: greeter\ndescription: Greets people.\n---\nUnsaved edit.`));

    const pinned = unwrap(
      await resolvePinnedVersionId(
        repo,
        parse({ skill: drifted, currentSkillId: created.id, branchId: branch.id }),
        userId,
      ),
    );

    expect(pinned).toBeNull();
  });
});
