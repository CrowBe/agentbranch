import type {
  AgentComponent,
  AgentConfigurationSnapshot,
  SourceFile,
  SourceSpan,
} from "@/modules/agent-configuration";
import {
  resolveEffectiveConfiguration,
  type EffectiveConfigurationGraph,
  type EffectiveConfigurationRelationshipKind,
  type EffectiveConfigurationResolutionRule,
  type EffectiveConfigurationRuleRelationship,
} from "@/modules/effective-configuration";

type RuntimePolicy = {
  readonly precedence: (component: AgentComponent) => number;
  readonly instructionOrder: (component: AgentComponent) => number;
};

const depth = (path: string) => path.split("/").length - 1;

const runtimePolicies: Readonly<Record<string, RuntimePolicy>> = {
  "claude-code": {
    precedence: (component) =>
      component.kind === "instruction" ? 100 + depth(component.path)
        : component.path === ".claude/settings.local.json" ? 300
        : component.path === ".claude/settings.json" ? 200
          : 100,
    instructionOrder: (component) =>
      component.path === "CLAUDE.md" ? 0 : 100 + depth(component.path),
  },
  codex: {
    precedence: (component) =>
      component.kind === "instruction" ? 100 + depth(component.path) : 200,
    instructionOrder: (component) =>
      component.path === "AGENTS.md" ? 0 : 100 + depth(component.path),
  },
  openclaw: {
    precedence: (component) =>
      component.path === ".openclaw/openclaw.json" ? 300
        : component.path === "openclaw.json" ? 200
          : 100,
    instructionOrder: (component) => depth(component.path),
  },
  agents: {
    precedence: (component) =>
      100 + depth(component.path) + (component.path.endsWith("/local.md") ? 1 : 0),
    instructionOrder: (component) =>
      component.path === "AGENTS.md" ? 0 : 100 + depth(component.path),
  },
};

function sourceFile(
  snapshot: AgentConfigurationSnapshot,
  component: AgentComponent,
): SourceFile | undefined {
  return snapshot.files.find((file) => file.path === component.path);
}

function sourceLabel(file: SourceFile | undefined, component: AgentComponent): string {
  if (!file || file.encoding !== "utf8") return component.path;
  if (component.kind === "skill" || component.kind === "subagent") {
    const name = /^name:\s*["']?([^"'\r\n]+)["']?\s*$/m.exec(file.content)?.[1]?.trim();
    if (name) return name;
  }
  const setting = component.importProvenance?.rule.match(/\.settings\.([A-Za-z0-9_-]+)$/)?.[1];
  return setting ?? component.path;
}

function declaration(
  component: AgentComponent,
  label: string,
): string | undefined {
  const runtime = component.importProvenance?.runtime ?? "unknown-runtime";
  if (component.kind === "instruction") return `${runtime}:instruction`;
  if (
    component.importProvenance?.rule.includes(".settings.")
    || component.kind === "skill"
    || component.kind === "subagent"
  ) {
    return `${runtime}:${component.kind}:${label}`;
  }
  return undefined;
}

function lineSpan(lineNumber: number, line: string, start: number, end: number): SourceSpan {
  return {
    startLine: lineNumber,
    startColumn: start + 1,
    endLine: lineNumber,
    endColumn: Math.max(start + 1, end + 1),
  };
}

const RELATIONSHIP_PATTERN =
  /\b(loads?|overrides?|references?|selects?|delegates?\s+to|permits?|requires?|uses?)\s+(?:the\s+)?[`"']?([A-Za-z0-9_./-]+)[`"']?/gi;

function relationshipKind(verb: string): EffectiveConfigurationRelationshipKind {
  const normalized = verb.toLowerCase().replace(/\s+/g, " ");
  if (normalized.startsWith("load")) return "loads";
  if (normalized.startsWith("override")) return "overrides";
  if (normalized.startsWith("reference")) return "references";
  if (normalized.startsWith("select")) return "selects";
  if (normalized.startsWith("delegate")) return "delegates-to";
  if (normalized.startsWith("permit")) return "permits";
  if (normalized.startsWith("require")) return "requires";
  return "unknown";
}

function explicitRelationships(file: SourceFile | undefined): EffectiveConfigurationRuleRelationship[] {
  if (!file || file.encoding !== "utf8") return [];
  const relationships: EffectiveConfigurationRuleRelationship[] = [];
  for (const [index, line] of file.content.split("\n").entries()) {
    for (const match of line.matchAll(RELATIONSHIP_PATTERN)) {
      const rawTarget = match[2]!;
      const target = rawTarget.replace(/[.,;:!?]+$/, "");
      const targetStart = (match.index ?? 0) + match[0].lastIndexOf(target);
      relationships.push({
        kind: relationshipKind(match[1]!),
        target,
        confidence: match[1]!.toLowerCase().startsWith("use") ? "ambiguous" : "certain",
        span: lineSpan(index + 1, line, targetStart, targetStart + target.length),
      });
    }
    for (const match of line.matchAll(/\[[^\]]+\]\(([^)#]+)(?:#[^)]+)?\)/g)) {
      const target = match[1]!;
      const targetStart = (match.index ?? 0) + match[0].indexOf(target);
      relationships.push({
        kind: "references",
        target,
        confidence: "certain",
        span: lineSpan(index + 1, line, targetStart, targetStart + target.length),
      });
    }
    for (const match of line.matchAll(/["']?\$ref["']?\s*[:=]\s*["']([^"']+)["']/g)) {
      const target = match[1]!;
      const targetStart = (match.index ?? 0) + match[0].indexOf(target);
      relationships.push({
        kind: "references",
        target,
        confidence: "certain",
        span: lineSpan(index + 1, line, targetStart, targetStart + target.length),
      });
    }
  }
  return relationships;
}

/**
 * Runtime-specific precedence stops here. The returned declarations and
 * relationships use only the domain graph vocabulary.
 */
export function effectiveConfigurationRulesForImportedSnapshot(
  snapshot: AgentConfigurationSnapshot,
): readonly EffectiveConfigurationResolutionRule[] {
  return [...snapshot.components]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((component) => {
      const runtime = component.importProvenance?.runtime ?? "unknown";
      const policy = runtimePolicies[runtime];
      const file = sourceFile(snapshot, component);
      const label = sourceLabel(file, component);
      return {
        componentId: component.id,
        adapterRule:
          component.importProvenance?.rule
          ?? "import.unattributed-component",
        label,
        ...(declaration(component, label)
          ? { declaration: declaration(component, label) }
          : {}),
        precedence: policy?.precedence(component) ?? 0,
        ...(component.kind === "instruction"
          ? { instructionOrder: policy?.instructionOrder(component) ?? Number.MAX_SAFE_INTEGER }
          : {}),
        root: component.kind === "instruction"
          || component.kind === "model"
          || component.kind === "policy",
        relationships: explicitRelationships(file),
      };
    });
}

export function resolveImportedEffectiveConfiguration(
  snapshot: AgentConfigurationSnapshot,
): EffectiveConfigurationGraph {
  return resolveEffectiveConfiguration({
    snapshot,
    rules: effectiveConfigurationRulesForImportedSnapshot(snapshot),
  });
}
