import { beforeEach, describe, expect, it, vi } from "vitest";
import { ok, UserId } from "@/shared";
import { GET } from "./route";

const currentIdentity = vi.fn();
const findComparableById = vi.fn();

vi.mock("@/server/container", () => ({
  getContainer: () => ({
    auth: { currentIdentity },
    evalRuns: { findComparableById },
  }),
}));

beforeEach(() => {
  currentIdentity.mockReset();
  findComparableById.mockReset().mockResolvedValue(ok(null));
});

describe("evaluation comparison route", () => {
  it("requires authentication before reading either run", async () => {
    currentIdentity.mockResolvedValue(ok(null));

    const response = await GET(
      new Request("http://local/api/eval-comparison?leftRunId=l&rightRunId=r"),
    );

    expect(response.status).toBe(401);
    expect(findComparableById).not.toHaveBeenCalled();
  });

  it("validates the ordered run ids and method version", async () => {
    currentIdentity.mockResolvedValue(ok({ userId: UserId("u1"), email: "u@example.test" }));

    expect((await GET(new Request("http://local/api/eval-comparison"))).status).toBe(400);
    expect(
      (
        await GET(
          new Request(
            "http://local/api/eval-comparison?leftRunId=l&rightRunId=r&methodVersion=2",
          ),
        )
      ).status,
    ).toBe(400);
    expect(findComparableById).not.toHaveBeenCalled();
  });

  it("uses the authenticated user scope and hides missing or foreign runs alike", async () => {
    currentIdentity.mockResolvedValue(ok({ userId: UserId("u1"), email: "u@example.test" }));

    const response = await GET(
      new Request("http://local/api/eval-comparison?leftRunId=l&rightRunId=r&methodVersion=1"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      comparable: false,
      reason: "run-not-found-or-not-owned",
      leftRunId: "l",
      rightRunId: "r",
    });
    expect(findComparableById).toHaveBeenCalledTimes(2);
    expect(findComparableById.mock.calls.map((call) => call[1])).toEqual([
      UserId("u1"),
      UserId("u1"),
    ]);
  });
});
