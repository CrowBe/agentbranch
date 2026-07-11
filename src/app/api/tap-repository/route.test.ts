import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Publication, TapRepositorySkill } from "@/modules/publication";
import { serializeSkillMd } from "@/modules/skill";
import { ok, PublicationId, SafetyRatingId, SkillId, SkillVersionId, UserId } from "@/shared";
import { GET } from "./route";

const listTapRepositorySkills = vi.fn();
const latestForVersion = vi.fn();

vi.mock("@/server/container", () => ({
  getContainer: () => ({
    publications: { listTapRepositorySkills },
    safetyRatings: { latestForVersion },
  }),
}));

const source = {
  frontmatter: {
    name: "inbox-triage",
    description: "Use when unread invoices need bookkeeping triage.",
    extra: {},
  },
  body: "Review unread invoices and identify the next bookkeeping action.\n",
};

function tapSkill(input: Pick<Publication, "slug" | "tier" | "contentHash">): TapRepositorySkill {
  return {
    publication: {
      id: PublicationId(`pub-${input.slug}`),
      publisherId: UserId("user-1"),
      skillId: SkillId(`skill-${input.slug}`),
      skillVersionId: SkillVersionId(`version-${input.slug}`),
      slug: input.slug,
      tier: input.tier,
      contentHash: input.contentHash,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    },
    source,
  };
}

describe("GET /api/tap-repository", () => {
  beforeEach(() => {
    listTapRepositorySkills.mockReset();
    latestForVersion.mockReset();
    const content = serializeSkillMd(source);
    listTapRepositorySkills.mockResolvedValue(ok([
      tapSkill({
        slug: "ben/inbox-triage",
        tier: "published",
        contentHash: `sha256:${createHash("sha256").update(content).digest("hex")}`,
      }),
    ]));
    latestForVersion.mockResolvedValue(ok({
      id: SafetyRatingId("rating-1"),
      skillId: SkillId("skill-ben/inbox-triage"),
      skillVersionId: SkillVersionId("version-ben/inbox-triage"),
      harnessVersionId: null,
      userId: UserId("user-1"),
      verdict: "passed",
      result: {},
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    }));
  });

  it("returns the rendered tap marketplace and pinned SKILL.md files", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.files).toEqual([
      {
        path: ".claude-plugin/marketplace.json",
        content: expect.stringContaining('"status": "safety-badge"'),
      },
      {
        path: "skills/ben/inbox-triage/SKILL.md",
        content: serializeSkillMd(source),
      },
    ]);
    expect(body.files[0].content).toContain('"path": "skills/ben/inbox-triage"');
  });
});
