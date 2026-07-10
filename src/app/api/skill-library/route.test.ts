import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Publication } from "@/modules/publication";
import { ok, PublicationId, SafetyRatingId, SkillId, SkillVersionId, UserId } from "@/shared";
import { GET } from "./route";

const listVisible = vi.fn();
const latestForVersion = vi.fn();

vi.mock("@/server/container", () => ({
  getContainer: () => ({
    publications: { listVisible },
    safetyRatings: { latestForVersion },
  }),
}));

function publication(input: Pick<Publication, "slug" | "tier" | "contentHash">): Publication {
  return {
    id: PublicationId(`pub-${input.slug}`),
    publisherId: UserId("user-1"),
    skillId: SkillId(`skill-${input.slug}`),
    skillVersionId: SkillVersionId(`version-${input.slug}`),
    slug: input.slug,
    tier: input.tier,
    contentHash: input.contentHash,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  };
}

describe("GET /api/skill-library", () => {
  beforeEach(() => {
    listVisible.mockReset();
    latestForVersion.mockReset();
    listVisible.mockResolvedValue(ok([
      publication({ slug: "ben/inbox-triage", tier: "reviewed", contentHash: "sha256:reviewed" }),
      publication({ slug: "ben/published-helper", tier: "published", contentHash: "sha256:published" }),
    ]));
    latestForVersion.mockImplementation(async (_skillId, _userId, skillVersionId) => {
      if (skillVersionId === SkillVersionId("version-ben/inbox-triage")) {
        return ok({
          id: SafetyRatingId("rating-reviewed"),
          skillId: SkillId("skill-ben/inbox-triage"),
          skillVersionId,
          harnessVersionId: null,
          userId: UserId("user-1"),
          verdict: "passed",
          result: {},
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
        });
      }
      return ok(null);
    });
  });

  it("surfaces reviewed publications for the Skill library", async () => {
    const response = await GET(new Request("https://example.test/api/skill-library"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      surface: "library",
      entries: [
        {
          name: "inbox-triage",
          owner: "ben",
          slug: "ben/inbox-triage",
          tier: "reviewed",
          trustLabel: "reviewed skill - human-reviewed",
          safety: {
            status: "safety-badge",
            label: "safety badge",
            ratingId: SafetyRatingId("rating-reviewed"),
          },
          surfaced: true,
          contentHash: "sha256:reviewed",
          source: {
            type: "git",
            ref: "HEAD",
            path: "skills/ben/inbox-triage",
          },
        },
      ],
    });
  });

  it("keeps Templates as a reviewed-tier view", async () => {
    const response = await GET(new Request("https://example.test/api/skill-library?surface=templates&q=inbox"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      surface: "templates",
      entries: [{ slug: "ben/inbox-triage", tier: "reviewed" }],
    });
  });

  it("returns published publications only by direct link with the potentially-unsafe label", async () => {
    const response = await GET(
      new Request("https://example.test/api/skill-library?slug=ben/published-helper"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      entries: [
        {
          slug: "ben/published-helper",
          tier: "published",
          surfaced: false,
          trustLabel: "published skill",
          safety: {
            status: "potentially-unsafe",
            label: "potentially unsafe — not validated",
            ratingId: null,
          },
          contentHash: "sha256:published",
        },
      ],
    });
  });
});
