import { beforeEach, describe, expect, it, vi } from "vitest";
import { ok, UserId } from "@/shared";
import { GET } from "./route";

const currentIdentity = vi.fn();
const listByUser = vi.fn();

vi.mock("@/server/container", () => ({
  getContainer: () => ({
    auth: { currentIdentity },
    skills: { listByUser },
  }),
}));

describe("GET /api/skills", () => {
  beforeEach(() => {
    currentIdentity.mockReset();
    listByUser.mockReset();
  });

  it("lists the signed-in user's skills", async () => {
    currentIdentity.mockResolvedValue(ok({ userId: UserId("user-1") }));
    listByUser.mockResolvedValue(ok([
      {
        id: "skill-1",
        source: {
          frontmatter: { name: "inbox-triage", description: "Sort mail.", extra: {} },
          body: "# Goal",
        },
        latestRevision: 2,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-02T00:00:00.000Z"),
      },
    ]));

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      skills: [
        {
          id: "skill-1",
          name: "inbox-triage",
          description: "Sort mail.",
          latestRevision: 2,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-02T00:00:00.000Z",
        },
      ],
    });
    expect(listByUser).toHaveBeenCalledWith("user-1");
  });

  it("requires a signed-in user", async () => {
    currentIdentity.mockResolvedValue(ok(null));

    const response = await GET();

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Sign in to list skills." });
    expect(listByUser).not.toHaveBeenCalled();
  });
});
