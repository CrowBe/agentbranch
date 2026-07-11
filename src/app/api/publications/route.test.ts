import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { serializeSkillMd } from "@/modules/skill";
import { ok, PublicationId, SkillId, SkillVersionId, UserId } from "@/shared";
import { POST } from "./route";

const currentIdentity = vi.fn();
const findById = vi.fn();
const createPublication = vi.fn();
const consumeRateLimit = vi.fn();

vi.mock("@/server/container", () => ({
  getContainer: () => ({
    auth: { currentIdentity },
    skills: { findById },
    publications: { create: createPublication },
    requestRateLimiter: { consume: consumeRateLimit },
  }),
}));

const source = {
  frontmatter: { name: "inbox-triage", description: "Sort mail.", extra: {} },
  body: "# Goal\n\nKeep invoices moving.",
};

describe("POST /api/publications", () => {
  beforeEach(() => {
    currentIdentity.mockReset();
    findById.mockReset();
    createPublication.mockReset();
    consumeRateLimit.mockReset();

    currentIdentity.mockResolvedValue(ok({ userId: UserId("user-1"), email: "ben@example.com" }));
    findById.mockResolvedValue(ok({
      id: SkillId("skill-1"),
      userId: UserId("user-1"),
      source,
      latestRevision: 3,
      latestVersionId: SkillVersionId("version-3"),
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-05T00:00:00.000Z"),
    }));
    consumeRateLimit.mockResolvedValue(ok({ allowed: true }));
    createPublication.mockImplementation(async (input) =>
      ok({
        id: PublicationId("publication-1"),
        publisherId: input.publisherId,
        skillId: input.skillId,
        skillVersionId: input.skillVersionId,
        slug: `${input.slug.owner}/${input.slug.name}`,
        tier: input.tier,
        contentHash: input.contentHash,
        createdAt: new Date("2026-07-11T00:00:00.000Z"),
      }),
    );
  });

  it("publishes the signed-in user's main version with a pinned content hash", async () => {
    const response = await POST(
      new Request("https://example.test/api/publications", {
        method: "POST",
        body: JSON.stringify({ skillId: "skill-1", slug: { owner: "Ben", name: "Invoice-Triage" } }),
      }),
    );

    const contentHash = `sha256:${createHash("sha256").update(serializeSkillMd(source)).digest("hex")}`;
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      publication: {
        id: "publication-1",
        slug: "ben/invoice-triage",
        tier: "published",
        skillId: "skill-1",
        skillVersionId: "version-3",
        contentHash,
        createdAt: "2026-07-11T00:00:00.000Z",
      },
    });
    expect(findById).toHaveBeenCalledWith("skill-1", "user-1");
    expect(createPublication).toHaveBeenCalledWith({
      publisherId: "user-1",
      skillId: "skill-1",
      skillVersionId: "version-3",
      slug: { owner: "ben", name: "invoice-triage" },
      tier: "published",
      contentHash,
    });
  });

  it("requires a signed-in user", async () => {
    currentIdentity.mockResolvedValue(ok(null));

    const response = await POST(
      new Request("https://example.test/api/publications", {
        method: "POST",
        body: JSON.stringify({ skillId: "skill-1", slug: { owner: "ben", name: "inbox-triage" } }),
      }),
    );

    expect(response.status).toBe(401);
    expect(findById).not.toHaveBeenCalled();
    expect(createPublication).not.toHaveBeenCalled();
  });

  it("rejects malformed publish requests", async () => {
    const response = await POST(
      new Request("https://example.test/api/publications", {
        method: "POST",
        body: JSON.stringify({ skillId: "", slug: { owner: "", name: "" } }),
      }),
    );

    expect(response.status).toBe(400);
    expect(findById).not.toHaveBeenCalled();
    expect(createPublication).not.toHaveBeenCalled();
  });
});
