import { beforeEach, describe, expect, it, vi } from "vitest";
import { ok, UserId } from "@/shared";
import { GET, POST } from "./route";

const currentIdentity = vi.fn();
const snapshot = vi.fn();
const setActive = vi.fn();
const config = {
  flags: { hasAuth: true, hasDatabase: false, hasModel: true },
  admin: { userIds: ["admin-1"], emails: ["boss@acme.test"] },
};

vi.mock("@/server/container", () => ({
  getContainer: () => ({
    auth: { currentIdentity },
    modelRouter: { snapshot, setActive },
    config,
  }),
}));

const SNAPSHOT = { providers: [], active: { providerId: "anthropic" } };

beforeEach(() => {
  currentIdentity.mockReset();
  snapshot.mockReset().mockReturnValue(SNAPSHOT);
  setActive.mockReset().mockReturnValue(ok(SNAPSHOT));
  config.flags.hasAuth = true;
});

function postSelect(providerId: string): Request {
  return new Request("https://example.test/api/model-router", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "select", providerId }),
  });
}

describe("model-router route — authorization", () => {
  it("401s a signed-out caller", async () => {
    currentIdentity.mockResolvedValue(ok(null));
    expect((await GET()).status).toBe(401);
  });

  it("403s a signed-in non-admin when auth is configured", async () => {
    currentIdentity.mockResolvedValue(ok({ userId: UserId("rando"), email: "rando@acme.test" }));
    const get = await GET();
    const post = await POST(postSelect("nous"));
    expect(get.status).toBe(403);
    expect(post.status).toBe(403);
    expect(setActive).not.toHaveBeenCalled();
  });

  it("allows an allowlisted admin to read and switch", async () => {
    currentIdentity.mockResolvedValue(ok({ userId: UserId("admin-1"), email: "x@acme.test" }));
    expect((await GET()).status).toBe(200);
    expect((await POST(postSelect("nous"))).status).toBe(200);
    expect(setActive).toHaveBeenCalledWith({ providerId: "nous", modelIds: undefined });
  });

  it("matches an admin by email too", async () => {
    currentIdentity.mockResolvedValue(ok({ userId: UserId("other"), email: "Boss@Acme.test" }));
    expect((await GET()).status).toBe(200);
  });

  it("is open on a no-auth dev box", async () => {
    config.flags.hasAuth = false;
    currentIdentity.mockResolvedValue(ok({ userId: UserId("dev"), email: "dev@local" }));
    expect((await GET()).status).toBe(200);
  });
});
