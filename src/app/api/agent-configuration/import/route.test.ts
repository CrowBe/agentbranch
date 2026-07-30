import { beforeEach, describe, expect, it, vi } from "vitest";
import { ok, UserId } from "@/shared";
import { defaultAgentConfigurationImportAdapters } from "@/infra/agent-configuration-import";
import { POST } from "./route";

const currentIdentity = vi.fn();
const consumeRateLimit = vi.fn();
const createConfiguration = vi.fn();

vi.mock("@/server/container", () => ({
  getContainer: () => ({
    auth: { currentIdentity },
    requestRateLimiter: { consume: consumeRateLimit },
    agentConfigurations: { create: createConfiguration },
    agentConfigurationImportAdapters: defaultAgentConfigurationImportAdapters,
  }),
}));

const CLAUDE_MD = `# Project guide

Follow the house style.
`;

const SETTINGS = JSON.stringify({ model: "claude-opus-5", apiKey: "sk-secret-value" });

function archive(): Uint8Array {
  return tar([
    [".claude/CLAUDE.md", encode(CLAUDE_MD)],
    [".claude/settings.json", encode(SETTINGS)],
  ]);
}

function post(query: string, body: Uint8Array = archive()): Promise<Response> {
  return POST(
    new Request(`https://example.test/api/agent-configuration/import${query}`, {
      method: "POST",
      body: body as BodyInit,
    }),
  );
}

describe("POST /api/agent-configuration/import", () => {
  beforeEach(() => {
    currentIdentity.mockReset();
    consumeRateLimit.mockReset();
    createConfiguration.mockReset();
    consumeRateLimit.mockResolvedValue(ok({ allowed: true }));
    currentIdentity.mockResolvedValue(ok({ userId: UserId("user-1"), email: "u@example.test" }));
  });

  it("previews an archive without saving anything", async () => {
    const response = await post("?format=tar");

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.saved).toBeNull();
    expect(body.preview.runtimes.map((r: { runtime: string }) => r.runtime)).toContain("claude-code");
    expect(createConfiguration).not.toHaveBeenCalled();
  });

  it("keeps secret values out of the preview but names the requirement", async () => {
    const response = await post("?format=tar");

    const rendered = JSON.stringify(await response.json());
    expect(rendered).not.toContain("sk-secret-value");
    expect(rendered).toContain("apiKey");
  });

  it("saves the snapshot it just derived when asked to", async () => {
    createConfiguration.mockImplementation(async ({ userId, name }) =>
      ok({
        id: "config-1",
        userId,
        name,
        mainVersion: { id: "version-1", configurationId: "config-1", revision: 1 },
        createdAt: new Date(0),
        updatedAt: new Date(0),
      }),
    );

    const response = await post("?format=tar&save=1&name=My%20setup");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ saved: { id: "config-1", name: "My setup" } });
    expect(createConfiguration).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1", name: "My setup" }),
    );
  });

  it("refuses to save a configuration with no name", async () => {
    const response = await post("?format=tar&save=1");

    expect(response.status).toBe(400);
    expect(createConfiguration).not.toHaveBeenCalled();
  });

  it("rejects an archive format it does not read", async () => {
    const response = await post("?format=rar");

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining(".zip") });
  });

  it("reports an unreadable archive as a request problem, not a crash", async () => {
    const response = await post("?format=zip", new Uint8Array(32));

    expect(response.status).toBe(400);
    expect(createConfiguration).not.toHaveBeenCalled();
  });

  it("refuses an empty body", async () => {
    const response = await post("?format=tar", new Uint8Array(0));

    expect(response.status).toBe(400);
  });

  it("rate-limits agent-configuration imports per user", async () => {
    consumeRateLimit.mockResolvedValue(ok({
      allowed: false,
      reason: "You're going a little fast - give it a few seconds and try again.",
    }));

    const response = await post("?format=tar");

    expect(response.status).toBe(429);
    expect(createConfiguration).not.toHaveBeenCalled();
  });

  it("requires a signed-in user", async () => {
    currentIdentity.mockResolvedValue(ok(null));

    const response = await post("?format=tar");

    expect(response.status).toBe(401);
  });
});

function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** Minimal uncompressed tar writer — enough for a fixture, nothing more. */
function tar(entries: readonly (readonly [string, Uint8Array])[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  for (const [path, bytes] of entries) {
    const header = new Uint8Array(512);
    header.set(encode(path), 0);
    header.set(encode(`${bytes.byteLength.toString(8).padStart(11, "0")}\0`), 124);
    header[156] = "0".charCodeAt(0);
    chunks.push(header, bytes, new Uint8Array((512 - (bytes.byteLength % 512)) % 512));
  }
  chunks.push(new Uint8Array(1024));
  const output = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}
