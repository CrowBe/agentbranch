import { describe, it, expect } from "vitest";
import {
  createMemorySkillRepository,
  createMemorySkillRetentionRepository,
  createMemorySkillStore,
  type MemorySkillStore,
} from "./skill.memory-repository";
import { createMemoryEvalRunRepository } from "./eval.memory-repository";
import { parseSkillMd, type SkillRepository } from "@/modules/skill";
import { unwrap, UserId, type SkillId } from "@/shared";

const USER = UserId("u1");
const md = (description: string, body = "body") =>
  unwrap(parseSkillMd(`---\nname: t\ndescription: ${description}\n---\n${body}`));

function setup(): { store: MemorySkillStore; repo: SkillRepository } {
  const store = createMemorySkillStore();
  return { store, repo: createMemorySkillRepository(store) };
}

async function seedSkill(repo: SkillRepository): Promise<SkillId> {
  const created = unwrap(await repo.create({ userId: USER, source: md("main v1") }));
  return created.id;
}

describe("branching iteration — draft / main / promote (memory adapter)", () => {
  it("forks a draft off the blessed version without moving the main pointer", async () => {
    const { repo } = setup();
    const id = await seedSkill(repo);
    const mainBefore = unwrap(await repo.findById(id, USER));

    const branch = unwrap(await repo.createBranch({ id, userId: USER }));
    expect(branch.isMain).toBe(false);
    expect(branch.status).toBe("open");
    // The draft is seeded with a copy of the blessed version, ready to edit.
    expect(branch.headVersionId).toBeDefined();

    const seeded = unwrap(await repo.listBranchVersions(id, USER, branch.id));
    expect(seeded).toHaveLength(1);
    expect(seeded[0]?.source).toEqual(md("main v1"));
    expect(seeded[0]?.parentId).toBe(mainBefore?.latestVersionId);

    // Main is untouched by the fork.
    const mainAfter = unwrap(await repo.findById(id, USER));
    expect(mainAfter?.latestVersionId).toBe(mainBefore?.latestVersionId);
  });

  it("appends draft revisions append-only, leaving main where it was", async () => {
    const { repo } = setup();
    const id = await seedSkill(repo);
    const mainBefore = unwrap(await repo.findById(id, USER));
    const branch = unwrap(await repo.createBranch({ id, userId: USER }));

    const v2 = unwrap(await repo.saveToBranch({ id, userId: USER, branchId: branch.id, source: md("draft v2") }));
    const v3 = unwrap(await repo.saveToBranch({ id, userId: USER, branchId: branch.id, source: md("draft v3") }));
    expect(v2.revision).toBe(2);
    expect(v3.revision).toBe(3);
    expect(v3.parentId).toBe(v2.id); // chained as a DAG

    const versions = unwrap(await repo.listBranchVersions(id, USER, branch.id));
    expect(versions.map((v) => v.revision)).toEqual([3, 2, 1]);

    // Main lineage and its linear history are unchanged.
    const main = unwrap(await repo.findById(id, USER));
    expect(main?.latestVersionId).toBe(mainBefore?.latestVersionId);
    expect(unwrap(await repo.listVersions(id, USER))).toHaveLength(1);
  });

  it("promotes a draft: the blessed pointer moves to its head, append-only", async () => {
    const { store, repo } = setup();
    const id = await seedSkill(repo);
    const versionsBefore = (store.versions.get(id) ?? []).length;
    const branch = unwrap(await repo.createBranch({ id, userId: USER }));
    unwrap(await repo.saveToBranch({ id, userId: USER, branchId: branch.id, source: md("draft head") }));
    const head = unwrap(await repo.listBranchVersions(id, USER, branch.id))[0];

    const promoted = unwrap(await repo.promoteBranch({ id, userId: USER, branchId: branch.id }));
    expect(promoted.latestVersionId).toBe(head?.id);
    expect(promoted.source).toEqual(md("draft head"));

    // No version was created or mutated by promote — only the pointer moved.
    const created = unwrap(await repo.createBranch({ id, userId: USER })); // (just to read state)
    void created;
    // The promoted branch is now the main lineage.
    const branches = unwrap(await repo.listBranches(id, USER));
    expect(branches.find((b) => b.id === branch.id)?.isMain).toBe(true);

    // The seeded fork + one draft revision were the only additions (promote adds none).
    const versionsAfterPromote = (store.versions.get(id) ?? []).length;
    // versionsBefore(1) + fork seed(1) + draft(1) + the second fork's seed(1) = 4.
    expect(versionsAfterPromote).toBe(versionsBefore + 3);
  });

  it("discards a draft but refuses to discard the main lineage", async () => {
    const { repo } = setup();
    const id = await seedSkill(repo);
    const branch = unwrap(await repo.createBranch({ id, userId: USER }));

    unwrap(await repo.discardBranch({ id, userId: USER, branchId: branch.id }));
    const branches = unwrap(await repo.listBranches(id, USER));
    expect(branches.find((b) => b.id === branch.id)?.status).toBe("discarded");

    // A discarded draft rejects further appends.
    await expect(
      repo.saveToBranch({ id, userId: USER, branchId: branch.id, source: md("nope") }),
    ).resolves.toMatchObject({ ok: false, error: { tag: "invalid_operation" } });

    // The main branch cannot be discarded.
    const main = branches.find((b) => b.isMain);
    await expect(
      repo.discardBranch({ id, userId: USER, branchId: main!.id }),
    ).resolves.toMatchObject({ ok: false, error: { tag: "invalid_operation" } });
  });

  it("refuses to append draft revisions directly to the main lineage", async () => {
    const { repo } = setup();
    const id = await seedSkill(repo);
    const main = unwrap(await repo.listBranches(id, USER)).find((branch) => branch.isMain);

    await expect(
      repo.saveToBranch({ id, userId: USER, branchId: main!.id, source: md("main via branch") }),
    ).resolves.toMatchObject({ ok: false, error: { tag: "invalid_operation" } });

    const skill = unwrap(await repo.findById(id, USER));
    expect(skill?.source).toEqual(md("main v1"));
    expect(unwrap(await repo.listVersions(id, USER))).toHaveLength(1);
  });

  it("scopes branch operations to the owner", async () => {
    const { repo } = setup();
    const id = await seedSkill(repo);
    await expect(repo.createBranch({ id, userId: UserId("intruder") })).resolves.toMatchObject({
      ok: false,
      error: { tag: "not_found" },
    });
  });
});

describe("retention is a daily tidy, off the write path (memory adapter)", () => {
  it("keeps the latest N of a draft and never prunes its tip, leaving main whole", async () => {
    const { store, repo } = setup();
    const retention = createMemorySkillRetentionRepository(store);
    const id = await seedSkill(repo);
    unwrap(await repo.save({ id, userId: USER, source: md("main v2") })); // main has 2 now

    const branch = unwrap(await repo.createBranch({ id, userId: USER }));
    // Drive the draft well past the keep window (1 seed + 5 appends = 6 revisions).
    for (let n = 2; n <= 6; n += 1) {
      unwrap(await repo.saveToBranch({ id, userId: USER, branchId: branch.id, source: md(`draft v${n}`) }));
    }
    const tipBefore = unwrap(await repo.listBranchVersions(id, USER, branch.id))[0];

    const report = unwrap(await retention.prune({ keepPerBranch: 3, maxOpenDrafts: 10 }));
    expect(report.prunedVersions).toBe(3); // 6 → 3, interior pruned

    const draftVersions = unwrap(await repo.listBranchVersions(id, USER, branch.id));
    expect(draftVersions).toHaveLength(3);
    expect(draftVersions[0]?.id).toBe(tipBefore?.id); // tip never pruned
    expect(draftVersions.map((v) => v.revision)).toEqual([6, 5, 4]);
    // The tip keeps its (surviving) parent; the oldest kept revision loses its
    // dangling pointer to a pruned parent — mirroring the DB's onDelete: SetNull.
    expect(draftVersions[0]?.parentId).toBeDefined();
    expect(draftVersions.at(-1)?.parentId).toBeUndefined();

    // Main lineage is sacred — both of its revisions survive.
    expect(unwrap(await repo.listVersions(id, USER))).toHaveLength(2);
  });

  it("caps open drafts per skill, discarding the oldest excess", async () => {
    const { store, repo } = setup();
    const retention = createMemorySkillRetentionRepository(store);
    const id = await seedSkill(repo);
    const branches = [];
    for (let n = 0; n < 4; n += 1) {
      branches.push(unwrap(await repo.createBranch({ id, userId: USER })));
    }

    const report = unwrap(await retention.prune({ keepPerBranch: 10, maxOpenDrafts: 2 }));
    expect(report.discardedBranches).toBe(2);

    const after = unwrap(await repo.listBranches(id, USER));
    const open = after.filter((b) => b.status === "open" && !b.isMain);
    expect(open).toHaveLength(2);
    // The two oldest drafts (lowest ordinals) were the ones discarded.
    expect(open.map((b) => b.id).sort()).toEqual([branches[2]!.id, branches[3]!.id].sort());
  });

  it("lets a run record pinned to a pruned draft version survive (SetNull semantics)", async () => {
    const { store, repo } = setup();
    const retention = createMemorySkillRetentionRepository(store);
    const evalRuns = createMemoryEvalRunRepository();
    const id = await seedSkill(repo);
    const branch = unwrap(await repo.createBranch({ id, userId: USER }));
    for (let n = 2; n <= 4; n += 1) {
      unwrap(await repo.saveToBranch({ id, userId: USER, branchId: branch.id, source: md(`draft v${n}`) }));
    }
    // Pin an eval to an interior draft version that retention will prune.
    const interior = unwrap(await repo.listBranchVersions(id, USER, branch.id)).at(-1);
    const run = unwrap(
      await evalRuns.record({
        userId: USER,
        skillId: id,
        skillVersionId: interior!.id,
        status: "passed",
        result: {
          kind: "triggering-eval",
          passed: true,
          cases: [],
          insight: { verdict: "good", summary: "ok", findings: [], watch: [] },
        },
      }),
    );

    unwrap(await retention.prune({ keepPerBranch: 1, maxOpenDrafts: 10 }));

    // The pinned version is gone, but the run record survives its lifecycle.
    const remaining = unwrap(await repo.listBranchVersions(id, USER, branch.id));
    expect(remaining.some((v) => v.id === interior!.id)).toBe(false);
    expect(unwrap(await evalRuns.findById(run.id, USER))).not.toBeNull();
  });
});
