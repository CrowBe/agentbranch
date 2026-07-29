import { readFile, readdir } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  createAgentConfigurationImportPreviewAnalyzer,
  type SourceSnapshotFile,
} from "@/modules/agent-configuration-import";
import { unwrap } from "@/shared";
import { sourceSnapshotFromRepository } from "./source-snapshot";
import {
  effectiveConfigurationRulesForImportedSnapshot,
  resolveImportedEffectiveConfiguration,
} from "./effective-configuration-adapters";
import { defaultAgentConfigurationImportAdapters } from "./runtime-adapters";

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures");
const analyzer = createAgentConfigurationImportPreviewAnalyzer(
  defaultAgentConfigurationImportAdapters,
);

async function fixture(name: string) {
  const root = resolve(FIXTURES, name);
  const entries: SourceSnapshotFile[] = [];
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else entries.push({
        path: relative(root, path).replaceAll("\\", "/"),
        bytes: await readFile(path),
      });
    }
  }
  await visit(root);
  return sourceSnapshotFromRepository(entries);
}

describe("effective configuration runtime adapter goldens", () => {
  it.each([
    ["claude", ["CLAUDE.md", "packages/app/CLAUDE.md"]],
    ["codex", ["AGENTS.md", "packages/app/AGENTS.md"]],
    ["openclaw", ["openclaw.json", ".openclaw/openclaw.json"]],
    ["agents", [".agents/instructions/base.md", ".agents/instructions/local.md"]],
  ] as const)(
    "proves deterministic instruction order and override behavior for %s",
    async (name, expectedInstructionPaths) => {
      const preview = unwrap(await analyzer.analyze(await fixture(name)));
      const graph = resolveImportedEffectiveConfiguration(preview.snapshot);
      const repeated = resolveImportedEffectiveConfiguration(preview.snapshot);
      const nodes = new Map(graph.nodes.map((node) => [node.id, node]));

      expect(graph).toEqual(repeated);
      expect(graph.effective.instructions.map((id) => nodes.get(id)?.evidence.path))
        .toEqual(expectedInstructionPaths);
      expect(graph.edges.some((edge) =>
        edge.kind === "overrides" && edge.status === "resolved"
      )).toBe(true);
      expect(graph.nodes.every((node) =>
        node.evidence.adapterRule !== "import.unattributed-component"
      )).toBe(true);
    },
  );

  it("keeps runtime names and precedence out of the core graph vocabulary", async () => {
    const preview = unwrap(await analyzer.analyze(await fixture("claude")));
    const rules = effectiveConfigurationRulesForImportedSnapshot(preview.snapshot);
    const graph = resolveImportedEffectiveConfiguration(preview.snapshot);

    expect(rules.find((rule) =>
      rule.adapterRule === "claude-code.settings.model"
      && preview.snapshot.components.find((component) => component.id === rule.componentId)?.path
        === ".claude/settings.json"
    )?.precedence).toBe(200);
    expect(rules.find((rule) =>
      rule.adapterRule === "claude-code.settings.model"
      && preview.snapshot.components.find((component) => component.id === rule.componentId)?.path
        === ".claude/settings.local.json"
    )?.precedence).toBe(300);
    expect(Object.keys(graph)).not.toContain("runtime");
    expect(graph.edges.filter((edge) => edge.kind === "overrides")).toHaveLength(2);
  });
});
