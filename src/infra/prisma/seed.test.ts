import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { baselineSkillCorpus } from "@/modules/baseline-corpus";
import { parseSkillMd, serializeSkillMd } from "@/modules/skill";
import { renderTapRepositoryFiles, type TapRepositorySkill } from "@/modules/publication";
import { isErr, PublicationId, SkillId, SkillVersionId, UserId } from "@/shared";
import { baselineSeedRecords } from "../../../prisma/seed";

describe("production seed", () => {
  it("maps every baseline fixture to stable reviewed publication rows", () => {
    const first = baselineSeedRecords();
    const second = baselineSeedRecords();
    expect(first).toEqual(second);
    expect(first).toHaveLength(20);
    expect(new Set(first.map((record) => record.skillId))).toHaveLength(20);
    expect(first.every((record) => record.slug === `agentbranch/${record.name}`)).toBe(true);
  });

  it("renders the exact fixture bytes with the pinned publication hash", () => {
    const records = baselineSeedRecords();
    const skills: TapRepositorySkill[] = records.map((record) => {
      const fixture = baselineSkillCorpus.find((entry) => entry.id === record.corpusId);
      if (!fixture) throw new Error(`Missing fixture ${record.corpusId}`);
      const source = parseSkillMd(fixture.source);
      if (isErr(source)) throw new Error(source.error.message);
      expect(serializeSkillMd(source.value)).toBe(fixture.source);
      expect(record.contentHash).toBe(
        `sha256:${createHash("sha256").update(fixture.source).digest("hex")}`,
      );
      return {
        publication: {
          id: PublicationId(record.publicationId),
          publisherId: UserId("system:agentbranch"),
          skillId: SkillId(record.skillId),
          skillVersionId: SkillVersionId(record.versionId),
          slug: record.slug,
          tier: "reviewed" as const,
          contentHash: record.contentHash,
          createdAt: new Date(0),
        },
        source: source.value,
      };
    });

    const rendered = renderTapRepositoryFiles(skills);
    if (isErr(rendered)) throw new Error(rendered.error.message);
    expect(rendered.value.filter((file) => file.path.endsWith("/SKILL.md"))).toHaveLength(20);
  });
});
