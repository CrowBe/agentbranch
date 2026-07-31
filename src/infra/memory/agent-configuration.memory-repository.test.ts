import { describe, expect, it } from "vitest";
import {
  makeAgentConfigurationSnapshot,
  type AgentConfigurationRepository,
} from "@/modules/agent-configuration";
import { UserId, unwrap } from "@/shared";
import { createMemoryAgentConfigurationRepository } from "./agent-configuration.memory-repository";

export function agentConfigurationRepositoryContract(
  createRepository: () => Promise<AgentConfigurationRepository> | AgentConfigurationRepository,
  prepareOwner: (userId: UserId) => Promise<void> | void = () => {},
) {
  it("preserves unknown files and promotes configuration-wide drafts", async () => {
    const repository = await createRepository();
    const userId = UserId(`config-owner-${crypto.randomUUID()}`);
    await prepareOwner(userId);
    const source = makeAgentConfigurationSnapshot({
      files: [
        { path: "AGENTS.md", content: "Use the local skills." },
        { path: "vendor/unknown.cfg", content: "opaque=true\n" },
      ],
      components: [{ id: "root-instructions", kind: "instruction", path: "AGENTS.md" }],
      importProvenance: [
        { runtime: "agents", adapter: { id: "agents-layout", version: "1" } },
        { runtime: "codex", adapter: { id: "codex", version: "1" } },
      ],
    });
    const created = unwrap(await repository.create({ userId, name: "My agent", snapshot: source }));
    expect(created.mainVersion.snapshot.files[1]?.content).toBe("opaque=true\n");
    expect(created.mainVersion.snapshot.importProvenance).toEqual(source.importProvenance);
    expect(unwrap(await repository.findById(created.id, userId))?.mainVersion.snapshot.importProvenance)
      .toEqual(source.importProvenance);

    const candidate = makeAgentConfigurationSnapshot({
      files: source.files.map((file) => ({
        path: file.path,
        content: file.path === "AGENTS.md" ? "Use reviewed skills." : file.content,
      })),
      components: [{ id: "root-instructions", kind: "instruction", path: "AGENTS.md" }],
      importProvenance: source.importProvenance,
    });
    const savedDraft = unwrap(await repository.saveDraft({
      id: created.id,
      userId,
      snapshot: candidate,
    }));
    expect(savedDraft.snapshot.importProvenance).toEqual(source.importProvenance);
    expect(unwrap(await repository.getDraft(created.id, userId))?.snapshot.importProvenance)
      .toEqual(source.importProvenance);
    expect((await repository.findById(created.id, userId)).ok).toBe(true);
    const promoted = unwrap(await repository.promoteDraft({ id: created.id, userId }));
    expect(promoted.mainVersion.revision).toBe(2);
    expect(promoted.mainVersion.snapshot.importProvenance).toEqual(source.importProvenance);
    expect(promoted.mainVersion.snapshot.files.find((file) => file.path === "vendor/unknown.cfg")?.content)
      .toBe("opaque=true\n");
    const versions = unwrap(await repository.listVersions(created.id, userId));
    expect(versions).toHaveLength(2);
    for (const version of versions) {
      expect(version.snapshot.importProvenance).toEqual(source.importProvenance);
    }
    expect(unwrap(await repository.findById(created.id, UserId("other")))).toBeNull();
  });
}

describe("AgentConfigurationRepository memory contract", () => {
  agentConfigurationRepositoryContract(() => createMemoryAgentConfigurationRepository());
});

describe("AgentConfiguration snapshot", () => {
  it("preserves sensitive environment references as named requirements", () => {
    const snapshot = makeAgentConfigurationSnapshot({
      files: [{
        path: ".agents/environment.json",
        content: JSON.stringify({
          databaseUrl: "${DATABASE_URL}",
          authHeader: "${AUTH_HEADER}",
        }),
      }],
      secretRequirements: [
        { name: "DATABASE_URL", purpose: "Imported databaseUrl setting" },
        { name: "AUTH_HEADER", purpose: "Imported authHeader setting" },
      ],
    });

    expect(snapshot.files[0]?.content).toContain("${DATABASE_URL}");
    expect(snapshot.files[0]?.content).toContain("${AUTH_HEADER}");
    expect(snapshot.secretRequirements.every((item) => item.purpose.length > 0)).toBe(true);
  });

  it("redacts secret-like assignments and retains requirements without values", () => {
    const databaseUrl = "postgresql://agent:database-password@db.example.test/agentbranch";
    const bearerToken = "header.payload.signature";
    const authHeaderCanary = "AUTHHDR_MEMORY_CANARY_296_Q4M8_N0TLIVE";
    const privateKey = "-----BEGIN PRIVATE KEY-----\nc2VjcmV0\n-----END PRIVATE KEY-----";
    const snapshot = makeAgentConfigurationSnapshot({
      files: [{
        path: ".agents/config.env",
        content: [
          "OPENAI_API_KEY=sk-real-value",
          `DATABASE_URL=${databaseUrl}`,
          `Authorization="Bearer ${bearerToken}"`,
          `Proxy-Authorization: Bearer ${bearerToken}`,
          `authHeader="${authHeaderCanary}"`,
          privateKey,
          "MODEL=test",
        ].join("\n"),
      }],
      secretRequirements: [
        { name: "AUTH_HEADER", purpose: "Imported authHeader setting" },
        { name: "OPENAI_API_KEY", purpose: "Model access" },
      ],
    });
    const serialized = JSON.stringify(snapshot);
    for (const secret of [
      "sk-real-value",
      databaseUrl,
      "database-password",
      bearerToken,
      authHeaderCanary,
      "c2VjcmV0",
    ]) {
      expect(serialized).not.toContain(secret);
    }
    expect(snapshot.files[0]?.content).toContain("<redacted>");
    expect(snapshot.secretRequirements).toEqual([
      { name: "AUTH_HEADER", purpose: "Imported authHeader setting" },
      { name: "OPENAI_API_KEY", purpose: "Model access" },
    ]);
  });

  it("rejects traversal paths", () => {
    expect(() => makeAgentConfigurationSnapshot({
      files: [{ path: "../credentials", content: "nope" }],
    })).toThrow("normalized relative path");
  });

  it("rejects component spans outside their source content", () => {
    expect(() => makeAgentConfigurationSnapshot({
      files: [{ path: "AGENTS.md", content: "one line" }],
      components: [{
        id: "instructions",
        kind: "instruction",
        path: "AGENTS.md",
        span: { startLine: 99, startColumn: 1, endLine: 100, endColumn: 1 },
      }],
    })).toThrow(/invalid source span/i);
  });
});
