import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import type { PublicationRepository } from "./publication.repository";
import { serializeSkillMd, type SkillSource } from "@/modules/skill";
import { publishSkillVersion } from "./publish-skill-version";
import { renderSkillLibrary } from "./skill-library";
import { renderTapMarketplace } from "./tap-marketplace";
import { renderTapRepositoryFiles } from "./tap-repository";
import type { Publication } from "./publication.types";
import { PublicationId, SafetyRatingId, SkillId, SkillVersionId, UserId, ok } from "@/shared";
import type { RequestRateLimiter } from "@/modules/usage";

const baseInput = {
  publisherId: UserId("user_1"),
  skillId: SkillId("skill_1"),
  skillVersionId: SkillVersionId("version_1"),
  slug: { owner: "Ben", name: "Invoice-Triage" },
  tier: "published" as const,
  contentHash: "sha256:abc123",
};

function repo(): PublicationRepository {
  return {
    create: vi.fn(async (input) =>
      ok({
        id: PublicationId("pub_1"),
        publisherId: input.publisherId,
        skillId: input.skillId,
        skillVersionId: input.skillVersionId,
        slug: `${input.slug.owner}/${input.slug.name}`,
        tier: input.tier,
        contentHash: input.contentHash,
        createdAt: new Date("2026-07-09T00:00:00Z"),
      } satisfies Publication),
    ),
    findById: vi.fn(),
    findBySlug: vi.fn(),
    listVisible: vi.fn(),
    listTapRepositorySkills: vi.fn(),
    listByPublisher: vi.fn(),
    listByVersion: vi.fn(),
  };
}

function limiter(allowed = true): RequestRateLimiter {
  return {
    consume: vi.fn(async () =>
      ok(allowed ? ({ allowed: true } as const) : ({ allowed: false, reason: "Too fast." } as const)),
    ),
  };
}

function skillSource(name = "invoice-triage"): SkillSource {
  return {
    frontmatter: {
      name,
      description: "Use when invoices need triage before bookkeeping.",
      extra: {},
    },
    body: "Review the invoice and identify the next bookkeeping action.\n",
  };
}

function contentHashFor(source: SkillSource): string {
  return `sha256:${createHash("sha256").update(serializeSkillMd(source)).digest("hex")}`;
}

describe("publishSkillVersion", () => {
  it("normalizes the owner/name slug and records a published publication without requiring safety analysis", async () => {
    const publications = repo();
    const result = await publishSkillVersion({ publications, requestRateLimiter: limiter() }, baseInput);

    expect(result.ok).toBe(true);
    expect(result.ok && result.value.slug).toBe("ben/invoice-triage");
    expect(publications.create).toHaveBeenCalledWith(expect.objectContaining({ slug: {
      owner: "ben",
      name: "invoice-triage",
    }}));
  });

  it("allows reviewed publications without requiring a safety rating first", async () => {
    const publications = repo();
    const result = await publishSkillVersion(
      { publications, requestRateLimiter: limiter() },
      { ...baseInput, tier: "reviewed" },
    );

    expect(result.ok).toBe(true);
    expect(publications.create).toHaveBeenCalled();
  });

  it("spends the publish rate-limit window before recording", async () => {
    const publications = repo();
    const result = await publishSkillVersion({ publications, requestRateLimiter: limiter(false) }, baseInput);

    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.error.tag).toBe("cap_reached");
    expect(publications.create).not.toHaveBeenCalled();
  });
});

describe("renderTapMarketplace", () => {
  it("renders published and reviewed publications into a deterministic HEAD marketplace index with badge state", () => {
    const publications = [
      {
        id: PublicationId("pub_2"),
        publisherId: UserId("user_1"),
        skillId: SkillId("skill_2"),
        skillVersionId: SkillVersionId("version_2"),
        slug: "zara/calendar-cleanup",
        tier: "reviewed" as const,
        contentHash: "sha256:def456",
        createdAt: new Date("2026-07-09T00:00:00Z"),
      },
      {
        id: PublicationId("pub_private"),
        publisherId: UserId("user_1"),
        skillId: SkillId("skill_private"),
        skillVersionId: SkillVersionId("version_private"),
        slug: "ben/private-draft",
        tier: "private" as const,
        contentHash: "sha256:private",
        createdAt: new Date("2026-07-09T00:00:00Z"),
      },
      {
        id: PublicationId("pub_1"),
        publisherId: UserId("user_1"),
        skillId: SkillId("skill_1"),
        skillVersionId: SkillVersionId("version_1"),
        slug: "ben/invoice-triage",
        tier: "published" as const,
        contentHash: "sha256:abc123",
        createdAt: new Date("2026-07-09T00:00:00Z"),
      },
    ] satisfies readonly Publication[];

    expect(renderTapMarketplace(publications, [
      {
        skillVersionId: SkillVersionId("version_2"),
        verdict: "passed",
        ratingId: SafetyRatingId("rating_2"),
      },
    ])).toEqual({
      version: 1,
      skills: [
        {
          name: "invoice-triage",
          owner: "ben",
          slug: "ben/invoice-triage",
          tier: "published",
          contentHash: "sha256:abc123",
          safety: {
            status: "potentially-unsafe",
            label: "potentially unsafe — not validated",
            ratingId: null,
          },
          source: {
            type: "git",
            ref: "HEAD",
            path: "skills/ben/invoice-triage",
          },
        },
        {
          name: "calendar-cleanup",
          owner: "zara",
          slug: "zara/calendar-cleanup",
          tier: "reviewed",
          contentHash: "sha256:def456",
          safety: {
            status: "safety-badge",
            label: "safety badge",
            ratingId: SafetyRatingId("rating_2"),
          },
          source: {
            type: "git",
            ref: "HEAD",
            path: "skills/zara/calendar-cleanup",
          },
        },
      ],
    });
  });
});

describe("renderTapRepositoryFiles", () => {
  it("renders the tap marketplace and standard skill folders pinned to content hash", () => {
    const source = skillSource();
    const publication = {
      id: PublicationId("pub_1"),
      publisherId: UserId("user_1"),
      skillId: SkillId("skill_1"),
      skillVersionId: SkillVersionId("version_1"),
      slug: "ben/invoice-triage",
      tier: "published" as const,
      contentHash: contentHashFor(source),
      createdAt: new Date("2026-07-09T00:00:00Z"),
    } satisfies Publication;

    const files = renderTapRepositoryFiles([{ publication, source }], [
      {
        skillVersionId: SkillVersionId("version_1"),
        verdict: "passed",
        ratingId: SafetyRatingId("rating_1"),
      },
    ]);

    expect(files.ok).toBe(true);
    expect(files.ok && files.value).toEqual([
      {
        path: ".claude-plugin/marketplace.json",
        content: expect.stringContaining('"path": "skills/ben/invoice-triage"'),
      },
      {
        path: "skills/ben/invoice-triage/SKILL.md",
        content: serializeSkillMd(source),
      },
    ]);
    expect(files.ok && files.value[0]?.content).toContain('"status": "safety-badge"');
    expect(files.ok && files.value[0]?.content.endsWith("\n")).toBe(true);
  });

  it("refuses to render when the pinned publication hash does not match the SKILL.md bytes", () => {
    const source = skillSource();
    const files = renderTapRepositoryFiles([
      {
        publication: {
          id: PublicationId("pub_1"),
          publisherId: UserId("user_1"),
          skillId: SkillId("skill_1"),
          skillVersionId: SkillVersionId("version_1"),
          slug: "ben/invoice-triage",
          tier: "published",
          contentHash: "sha256:stale",
          createdAt: new Date("2026-07-09T00:00:00Z"),
        },
        source,
      },
    ]);

    expect(files.ok).toBe(false);
    expect(files.ok ? null : files.error.tag).toBe("invalid_operation");
  });
});

describe("renderSkillLibrary", () => {
  it("renders reviewed publications for Skill library surfaces and keeps published entries link-reachable", () => {
    const publications = [
      {
        id: PublicationId("pub_published"),
        publisherId: UserId("user_1"),
        skillId: SkillId("skill_published"),
        skillVersionId: SkillVersionId("version_published"),
        slug: "ben/published-helper",
        tier: "published" as const,
        contentHash: "sha256:published",
        createdAt: new Date("2026-07-09T00:00:00Z"),
      },
      {
        id: PublicationId("pub_reviewed"),
        publisherId: UserId("user_1"),
        skillId: SkillId("skill_reviewed"),
        skillVersionId: SkillVersionId("version_reviewed"),
        slug: "ben/inbox-triage",
        tier: "reviewed" as const,
        contentHash: "sha256:reviewed",
        createdAt: new Date("2026-07-09T00:00:00Z"),
      },
    ] satisfies readonly Publication[];

    const safetyRatings = [
      {
        skillVersionId: SkillVersionId("version_reviewed"),
        verdict: "passed" as const,
        ratingId: SafetyRatingId("rating_reviewed"),
      },
    ];

    expect(renderSkillLibrary(publications, { surface: "templates", safetyRatings })).toEqual({
      surface: "templates",
      entries: [
        expect.objectContaining({
          slug: "ben/inbox-triage",
          tier: "reviewed",
          surfaced: true,
          trustLabel: "reviewed skill - human-reviewed",
          safety: {
            status: "safety-badge",
            label: "safety badge",
            ratingId: SafetyRatingId("rating_reviewed"),
          },
        }),
      ],
    });
    expect(renderSkillLibrary(publications, { slug: "ben/published-helper", safetyRatings })).toEqual({
      surface: "library",
      entries: [
        expect.objectContaining({
          slug: "ben/published-helper",
          tier: "published",
          surfaced: false,
          trustLabel: "published skill",
          safety: {
            status: "potentially-unsafe",
            label: "potentially unsafe — not validated",
            ratingId: null,
          },
        }),
      ],
    });
  });
});
