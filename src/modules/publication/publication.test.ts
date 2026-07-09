import { describe, expect, it, vi } from "vitest";
import type { PublicationRepository } from "./publication.repository";
import { publishSkillVersion } from "./publish-skill-version";
import { renderTapMarketplace } from "./tap-marketplace";
import type { Publication } from "./publication.types";
import { HarnessVersionId, PublicationId, SkillId, SkillVersionId, UserId, ok } from "@/shared";
import type { RequestRateLimiter } from "@/modules/usage";

const baseInput = {
  publisherId: UserId("user_1"),
  skillId: SkillId("skill_1"),
  skillVersionId: SkillVersionId("version_1"),
  slug: { owner: "Ben", name: "Invoice-Triage" },
  tier: "community" as const,
  contentHash: "sha256:abc123",
  gate: {
    verdict: "passed" as const,
    gateRunId: "gate_1",
    harnessVersionId: HarnessVersionId("harness_1"),
  },
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
        gate: input.gate,
        createdAt: new Date("2026-07-09T00:00:00Z"),
      } satisfies Publication),
    ),
    findById: vi.fn(),
    findBySlug: vi.fn(),
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

describe("publishSkillVersion", () => {
  it("normalizes the owner/name slug and records a passed community publication", async () => {
    const publications = repo();
    const result = await publishSkillVersion({ publications, requestRateLimiter: limiter() }, baseInput);

    expect(result.ok).toBe(true);
    expect(result.ok && result.value.slug).toBe("ben/invoice-triage");
    expect(publications.create).toHaveBeenCalledWith(expect.objectContaining({ slug: {
      owner: "ben",
      name: "invoice-triage",
    }}));
  });

  it("blocks amplified tiers when the automated gate did not pass", async () => {
    const publications = repo();
    const result = await publishSkillVersion(
      { publications, requestRateLimiter: limiter() },
      { ...baseInput, gate: { ...baseInput.gate, verdict: "failed" } },
    );

    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.error.tag).toBe("invalid_operation");
    expect(publications.create).not.toHaveBeenCalled();
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
  it("renders community and reviewed publications into a deterministic HEAD marketplace index", () => {
    const gate = {
      verdict: "passed" as const,
      gateRunId: "gate_1",
      harnessVersionId: HarnessVersionId("harness_1"),
    };
    const publications = [
      {
        id: PublicationId("pub_2"),
        publisherId: UserId("user_1"),
        skillId: SkillId("skill_2"),
        skillVersionId: SkillVersionId("version_2"),
        slug: "zara/calendar-cleanup",
        tier: "reviewed" as const,
        contentHash: "sha256:def456",
        gate,
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
        gate,
        createdAt: new Date("2026-07-09T00:00:00Z"),
      },
      {
        id: PublicationId("pub_1"),
        publisherId: UserId("user_1"),
        skillId: SkillId("skill_1"),
        skillVersionId: SkillVersionId("version_1"),
        slug: "ben/invoice-triage",
        tier: "community" as const,
        contentHash: "sha256:abc123",
        gate,
        createdAt: new Date("2026-07-09T00:00:00Z"),
      },
    ] satisfies readonly Publication[];

    expect(renderTapMarketplace(publications)).toEqual({
      version: 1,
      skills: [
        {
          name: "invoice-triage",
          owner: "ben",
          slug: "ben/invoice-triage",
          tier: "community",
          contentHash: "sha256:abc123",
          gate,
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
          gate,
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
