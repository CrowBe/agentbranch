import type {
  AdapterImport,
  AdapterProbe,
  AdapterWarning,
  AgentConfigurationImportAdapter,
  ImportEvidence,
  ImportedComponent,
  RuntimeIdentity,
  SourceSnapshot,
} from "@/modules/agent-configuration-import";
import { sourceSpanForWholeFile } from "@/modules/agent-configuration-import";

type Rule = {
  readonly id: string;
  readonly test: (path: string) => boolean;
  readonly kind: ImportedComponent["kind"];
};

type AdapterDefinition = {
  readonly id: string;
  readonly runtime: RuntimeIdentity;
  readonly markers: readonly ((path: string) => boolean)[];
  readonly rules: readonly Rule[];
  readonly settings?: readonly {
    path: (path: string) => boolean;
    keys: Readonly<Record<string, ImportedComponent["kind"]>>;
  }[];
};

const UTF8 = new TextDecoder("utf-8", { fatal: true });

function fileEvidence(snapshot: SourceSnapshot, path: string): ImportEvidence {
  const file = snapshot.files.find((candidate) => candidate.path === path)!;
  return { path, span: sourceSpanForWholeFile(file.bytes) };
}

function textOf(bytes: Uint8Array): string | undefined {
  try {
    return UTF8.decode(bytes);
  } catch {
    return undefined;
  }
}

function positionAt(text: string, offset: number) {
  const lines = text.slice(0, offset).split("\n");
  return { line: lines.length, column: (lines.at(-1)?.length ?? 0) + 1 };
}

function keyEvidence(path: string, text: string, key: string): ImportEvidence | undefined {
  const patterns = [
    new RegExp(`"${key.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}"\\s*:`),
    new RegExp(`^\\s*${key.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\s*=`, "m"),
    new RegExp(`^\\s*\\[${key.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}(?:\\.|\\])`, "m"),
  ];
  const match = patterns.map((pattern) => pattern.exec(text)).find(Boolean);
  if (!match?.index && match?.index !== 0) return undefined;
  const start = positionAt(text, match.index);
  const end = positionAt(text, match.index + match[0].length);
  return {
    path,
    span: {
      startLine: start.line,
      startColumn: start.column,
      endLine: end.line,
      endColumn: end.column,
    },
  };
}

function createAdapter(definition: AdapterDefinition): AgentConfigurationImportAdapter {
  return {
    id: definition.id,
    version: "1",
    runtime: definition.runtime,
    probe(snapshot): AdapterProbe {
      const evidence = snapshot.files
        .filter((file) => definition.markers.some((marker) => marker(file.path)))
        .map((file) => fileEvidence(snapshot, file.path))
        .sort((a, b) => a.path.localeCompare(b.path));
      return { detected: evidence.length > 0, evidence };
    },
    import(snapshot, probe): AdapterImport {
      if (!probe.detected) return { components: [], warnings: [] };
      const components: ImportedComponent[] = [];
      const warnings: AdapterWarning[] = [];
      for (const file of snapshot.files) {
        for (const rule of definition.rules) {
          if (rule.test(file.path)) {
            components.push({
              kind: rule.kind,
              evidence: fileEvidence(snapshot, file.path),
              adapterRule: `${definition.id}.${rule.id}`,
            });
          }
        }
        for (const setting of definition.settings ?? []) {
          if (!setting.path(file.path)) continue;
          const text = textOf(file.bytes);
          if (text === undefined) {
            warnings.push({
              code: "settings-not-text",
              message: "Recognised settings could not be parsed as UTF-8 and remain unclassified.",
              evidence: fileEvidence(snapshot, file.path),
            });
            continue;
          }
          for (const [key, kind] of Object.entries(setting.keys)) {
            const evidence = keyEvidence(file.path, text, key);
            if (evidence) {
              components.push({
                kind,
                evidence,
                adapterRule: `${definition.id}.settings.${key}`,
              });
            }
          }
          if (!Object.keys(setting.keys).some((key) => keyEvidence(file.path, text, key))) {
            warnings.push({
              code: "settings-unsupported",
              message: "Recognised settings contain no supported source-backed component and are preserved.",
              evidence: fileEvidence(snapshot, file.path),
            });
          }
        }
      }
      return {
        components: deduplicateComponents(components),
        warnings,
      };
    },
  };
}

function deduplicateComponents(components: readonly ImportedComponent[]): ImportedComponent[] {
  const byKey = new Map<string, ImportedComponent>();
  for (const component of components) {
    const span = component.evidence.span;
    const key = `${component.kind}:${component.evidence.path}:${span.startLine}:${span.startColumn}`;
    byKey.set(key, component);
  }
  return [...byKey.values()].sort((a, b) =>
    `${a.evidence.path}:${a.kind}`.localeCompare(`${b.evidence.path}:${b.kind}`),
  );
}

const under = (root: string, suffix: string) => (path: string) =>
  path.startsWith(root) && path.endsWith(suffix);
const exact = (...paths: string[]) => (path: string) => paths.includes(path);

export const claudeCodeImportAdapter = createAdapter({
  id: "claude-code",
  runtime: "claude-code",
  markers: [
    (path) => path === "CLAUDE.md" || path.endsWith("/CLAUDE.md"),
    exact(".mcp.json", ".claude/settings.json", ".claude/settings.local.json"),
    (path) => path.startsWith(".claude/"),
  ],
  rules: [
    { id: "instructions", test: (path) => path === "CLAUDE.md" || path.endsWith("/CLAUDE.md"), kind: "instruction" },
    { id: "skill", test: under(".claude/skills/", "/SKILL.md"), kind: "skill" },
    { id: "subagent", test: under(".claude/agents/", ".md"), kind: "subagent" },
    { id: "mcp", test: exact(".mcp.json"), kind: "tool" },
    { id: "rule", test: under(".claude/rules/", ".md"), kind: "policy" },
    { id: "reference", test: (path) => path.startsWith(".claude/") && path.includes("/references/"), kind: "reference" },
  ],
  settings: [{
    path: exact(".claude/settings.json", ".claude/settings.local.json"),
    keys: { hooks: "hook", permissions: "policy", model: "model", mcpServers: "tool" },
  }],
});

export const codexImportAdapter = createAdapter({
  id: "codex",
  runtime: "codex",
  markers: [
    (path) => path === "AGENTS.md" || path.endsWith("/AGENTS.md"),
    exact(".codex/config.toml"),
    (path) => path.startsWith(".codex/"),
  ],
  rules: [
    { id: "instructions", test: (path) => path === "AGENTS.md" || path.endsWith("/AGENTS.md"), kind: "instruction" },
    { id: "skill", test: under(".codex/skills/", "/SKILL.md"), kind: "skill" },
    { id: "subagent", test: under(".codex/agents/", ".md"), kind: "subagent" },
    { id: "rule", test: (path) => path.startsWith(".codex/rules/"), kind: "policy" },
    { id: "reference", test: (path) => path.startsWith(".codex/references/"), kind: "reference" },
  ],
  settings: [{
    path: exact(".codex/config.toml"),
    keys: {
      model: "model",
      mcp_servers: "tool",
      approval_policy: "policy",
      sandbox_mode: "policy",
      hooks: "hook",
    },
  }],
});

export const openClawImportAdapter = createAdapter({
  id: "openclaw",
  runtime: "openclaw",
  markers: [
    exact("openclaw.json", ".openclaw/openclaw.json"),
    (path) => path.startsWith(".openclaw/"),
  ],
  rules: [
    { id: "instructions", test: exact("AGENTS.md"), kind: "instruction" },
    { id: "skill", test: under(".openclaw/skills/", "/SKILL.md"), kind: "skill" },
    { id: "subagent", test: under(".openclaw/agents/", ".md"), kind: "subagent" },
    { id: "reference", test: (path) => path.startsWith(".openclaw/references/"), kind: "reference" },
  ],
  settings: [{
    path: exact("openclaw.json", ".openclaw/openclaw.json"),
    keys: {
      agents: "subagent",
      tools: "tool",
      mcp: "tool",
      hooks: "hook",
      policies: "policy",
      model: "model",
      instructions: "instruction",
    },
  }],
});

export const agentsLayoutImportAdapter = createAdapter({
  id: "agents-layout",
  runtime: "agents",
  markers: [(path) => path.startsWith(".agents/")],
  rules: [
    { id: "instructions", test: (path) => path === "AGENTS.md" || path.startsWith(".agents/instructions/"), kind: "instruction" },
    { id: "skill", test: under(".agents/skills/", "/SKILL.md"), kind: "skill" },
    { id: "agent", test: under(".agents/agents/", ".md"), kind: "subagent" },
    { id: "subagent", test: under(".agents/subagents/", ".md"), kind: "subagent" },
    { id: "tool", test: (path) => /^\.agents\/(?:mcp|tools)\.(?:json|ya?ml)$/.test(path), kind: "tool" },
    { id: "hook", test: (path) => path.startsWith(".agents/hooks/"), kind: "hook" },
    { id: "policy", test: (path) => path.startsWith(".agents/policies/"), kind: "policy" },
    { id: "model", test: (path) => path.startsWith(".agents/models/"), kind: "model" },
    { id: "reference", test: (path) => path.startsWith(".agents/references/"), kind: "reference" },
  ],
});

export const defaultAgentConfigurationImportAdapters = Object.freeze([
  claudeCodeImportAdapter,
  codexImportAdapter,
  openClawImportAdapter,
  agentsLayoutImportAdapter,
]);
