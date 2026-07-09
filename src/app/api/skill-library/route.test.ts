import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Publication } from "@/modules/publication";
import { HarnessVersionId, ok, PublicationId, SkillId, SkillVersionId, UserId } from "@/shared";
import { GET } from "./route";

const listVisible = vi.fn();

vi.mock("@/server/container", () => ({
  getContainer: () => ({
    publications: { listVisible },
  }),
}));

const gate = {
  verdict: "passed",
  gateRunId: "gate-1",
  harnessVersionId: HarnessVersionId("harness-1"),
} as const;

function publication(input: Pick<Publication, "slug" | "tier" | "contentHash">): Publication {
  return {
    id: PublicationId(`pub-${input.slug}`),
    publisherId: UserId("user-1"),
    skillId: SkillId(`skill-${input.slug}`),
    skillVersionId: SkillVersionId(`version-${input.slug}`),
    slug: input.slug,
    tier: input.tier,
    contentHash: input.contentHash,
    gate,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  };
}

describe("GET /api/skill-library", () => {
  beforeEach(() => {
    listVisible.mockReset();
    listVisible.mockResolvedValue(ok([
      publication({ slug: "ben/inbox-triage", tier: "reviewed", contentHash: "sha256:reviewed" }),
      publication({ slug: "ben/community-helper", tier: "community", contentHash: "sha256:community" }),
    ]));
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
          surfaced: true,
          contentHash: "sha256:reviewed",
          gate,
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

  it("returns community publications only by direct link with the not-human-reviewed label", async () => {
    const response = await GET(
      new Request("https://example.test/api/skill-library?slug=ben/community-helper"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      entries: [
        {
          slug: "ben/community-helper",
          tier: "community",
          surfaced: false,
          trustLabel: "community skill - automated checks passed, not human-reviewed",
          contentHash: "sha256:community",
        },
      ],
    });
  });
});
