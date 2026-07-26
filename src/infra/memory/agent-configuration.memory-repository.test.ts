import { describe, expect, it } from "vitest";
import {
  makeAgentConfigurationSnapshot,
  type AgentConfigurationRepository,
} from "@/modules/agent-configuration";
import { UserId, unwrap } from "@/shared";
import { createMemoryAgentConfigurationRepository } from "./agent-configuration.memory-repository";

export function agentConfigurationRepositoryContract(
  createRepository: () => Promise<AgentConfigurationRepository> | AgentConfigurationRepository,
) {
  it("preserves unknown files and promotes configuration-wide drafts", async () => {
    const repository = await createRepository();
    const userId = UserId(`config-owner-${crypto.randomUUID()}`);
    const source = makeAgentConfigurationSnapshot({
      files: [
        { path: "AGENTS.md", content: "Use the local skills." },
        { path: "vendor/unknown.cfg", content: "opaque=true\n" },
      ],
      components: [{ id: "root-instructions", kind: "instruction", path: "AGENTS.md" }],
    });
    const created = unwrap(await repository.create({ userId, name: "My agent", snapshot: source }));
    expect(created.mainVersion.snapshot.files[1]?.content).toBe("opaque=true\n");

    const candidate = makeAgentConfigurationSnapshot({
      files: source.files.map((file) => ({
        path: file.path,
        content: file.path === "AGENTS.md" ? "Use reviewed skills." : file.content,
      })),
      components: [{ id: "root-instructions", kind: "instruction", path: "AGENTS.md" }],
    });
    await repository.saveDraft({ id: created.id, userId, snapshot: candidate });
    expect((await repository.findById(created.id, userId)).ok).toBe(true);
    const promoted = unwrap(await repository.promoteDraft({ id: created.id, userId }));
    expect(promoted.mainVersion.revision).toBe(2);
    expect(promoted.mainVersion.snapshot.files.find((file) => file.path === "vendor/unknown.cfg")?.content)
      .toBe("opaque=true\n");
    expect(unwrap(await repository.listVersions(created.id, userId))).toHaveLength(2);
    expect(unwrap(await repository.findById(created.id, UserId("other")))).toBeNull();
  });
}

describe("AgentConfigurationRepository memory contract", () => {
  agentConfigurationRepositoryContract(() => createMemoryAgentConfigurationRepository());
});

describe("AgentConfiguration snapshot", () => {
  it("redacts secret-like assignments and retains requirements without values", () => {
    const snapshot = makeAgentConfigurationSnapshot({
      files: [{ path: ".agents/config.env", content: "OPENAI_API_KEY=sk-real-value\nMODEL=test\n" }],
      secretRequirements: [{ name: "OPENAI_API_KEY", purpose: "Model access" }],
    });
    expect(JSON.stringify(snapshot)).not.toContain("sk-real-value");
    expect(snapshot.files[0]?.content).toContain("<redacted>");
    expect(snapshot.secretRequirements).toEqual([{ name: "OPENAI_API_KEY", purpose: "Model access" }]);
  });

  it("rejects traversal paths", () => {
    expect(() => makeAgentConfigurationSnapshot({
      files: [{ path: "../credentials", content: "nope" }],
    })).toThrow("normalized relative path");
  });
});
