import { beforeEach, describe, expect, it, vi } from "vitest";
import { domainError, ok, UserId } from "@/shared";
import { DELETE } from "./route";

const currentIdentity = vi.fn();
const deleteSkill = vi.fn();

vi.mock("@/server/container", () => ({
  getContainer: () => ({
    auth: { currentIdentity },
    skills: { delete: deleteSkill },
  }),
}));

describe("DELETE /api/skills/:id", () => {
  beforeEach(() => {
    currentIdentity.mockReset();
    deleteSkill.mockReset();
  });

  it("deletes the owned skill", async () => {
    currentIdentity.mockResolvedValue(ok({ userId: UserId("user-1") }));
    deleteSkill.mockResolvedValue(ok(undefined));

    const response = await DELETE(new Request("https://example.test/api/skills/skill-1"), {
      params: { id: "skill-1" },
    });

    expect(response.status).toBe(204);
    expect(deleteSkill).toHaveBeenCalledWith("skill-1", "user-1");
  });

  it("returns not found when the skill is missing or belongs to another user", async () => {
    currentIdentity.mockResolvedValue(ok({ userId: UserId("user-1") }));
    deleteSkill.mockResolvedValue({
      ok: false,
      error: domainError("not_found", "No skill skill-1."),
    });

    const response = await DELETE(new Request("https://example.test/api/skills/skill-1"), {
      params: { id: "skill-1" },
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "No skill skill-1.",
      code: "not_found",
    });
  });

  it("requires a signed-in user", async () => {
    currentIdentity.mockResolvedValue(ok(null));

    const response = await DELETE(new Request("https://example.test/api/skills/skill-1"), {
      params: { id: "skill-1" },
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Sign in to delete a skill." });
    expect(deleteSkill).not.toHaveBeenCalled();
  });
});
