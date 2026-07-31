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
    ["claude", ["packages/app/CLAUDE.md"], "CLAUDE.md"],
    ["codex", ["packages/app/AGENTS.md"], "AGENTS.md"],
    ["openclaw", [".openclaw/openclaw.json"], "openclaw.json"],
    ["agents", [".agents/instructions/local.md"], ".agents/instructions/base.md"],
  ] as const)(
    "proves deterministic instruction order and override behavior for %s",
    async (name, expectedInstructionPaths, shadowedPath) => {
      const preview = unwrap(await analyzer.analyze(await fixture(name)));
      const graph = resolveImportedEffectiveConfiguration(preview.snapshot);
      const repeated = resolveImportedEffectiveConfiguration(preview.snapshot);
      const nodes = new Map(graph.nodes.map((node) => [node.id, node]));

      expect(graph).toEqual(repeated);
      expect(graph.effective.instructions.map((id) => nodes.get(id)?.evidence.path))
        .toEqual(expectedInstructionPaths);
      const instructionOverrides = graph.edges.filter((edge) =>
        edge.kind === "overrides"
        && edge.status === "resolved"
        && edge.target === edge.to
        && nodes.get(edge.from)?.kind === "instruction"
      );
      expect(instructionOverrides).toHaveLength(1);
      expect(nodes.get(instructionOverrides[0]!.from)?.evidence.path)
        .toBe(expectedInstructionPaths[0]);
      expect(nodes.get(instructionOverrides[0]!.to!)?.evidence.path).toBe(shadowedPath);
      expect(graph.findings.filter((finding) => finding.code === "shadowed-instruction"))
        .toEqual([
          expect.objectContaining({
            evidence: expect.objectContaining({ path: shadowedPath }),
          }),
        ]);
      expect(graph.nodes.every((node) =>
        node.evidence.adapterRule !== "import.unattributed-component"
      )).toBe(true);
    },
  );

  it("normalizes prose terminal punctuation when extracting relationships", async () => {
    const preview = unwrap(await analyzer.analyze(await fixture("agents")));
    const graph = resolveImportedEffectiveConfiguration(preview.snapshot);

    expect(graph.edges).toContainEqual(expect.objectContaining({
      kind: "loads",
      target: "portable",
      status: "resolved",
    }));
    expect(graph.findings).not.toContainEqual(expect.objectContaining({
      code: "unresolved-reference",
      message: expect.stringContaining("portable"),
    }));
  });

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
    expect(graph.edges.filter((edge) =>
      edge.kind === "overrides" && edge.target === edge.to,
    )).toHaveLength(2);
  });
});
