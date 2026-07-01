import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { parseSkillMd } from "@/modules/skill";
import { SkillBranchId, SkillId, unwrap, UserId } from "@/shared";
import { createPrismaSkillRepository } from "./skill.prisma-repository";

const source = unwrap(parseSkillMd(`---
name: t
description: branch guard
---
body`));

describe("Prisma skill branching adapter", () => {
  it("refuses to append draft revisions directly to the main lineage", async () => {
    const createVersion = vi.fn();
    const tx = {
      skill: {
        findFirst: vi.fn().mockResolvedValue({ id: "skill-1", mainVersionId: "version-main" }),
      },
      skillBranch: {
        findFirst: vi.fn().mockResolvedValue({ id: "branch-main", skillId: "skill-1", status: "open" }),
      },
      skillVersion: {
        findUnique: vi.fn().mockResolvedValue({ branchId: "branch-main" }),
        create: createVersion,
      },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (transaction: typeof tx) => unknown) => callback(tx)),
    } as unknown as PrismaClient;
    const repo = createPrismaSkillRepository(prisma);

    const result = await repo.saveToBranch({
      id: SkillId("skill-1"),
      userId: UserId("user-1"),
      branchId: SkillBranchId("branch-main"),
      source,
    });

    expect(result).toMatchObject({ ok: false, error: { tag: "invalid_operation" } });
    expect(createVersion).not.toHaveBeenCalled();
  });
});
