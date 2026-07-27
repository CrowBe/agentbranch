import { createHash } from "node:crypto";
import {
  makeAgentConfigurationSnapshot,
  type AgentComponent,
  type AgentComponentKind,
  type SecretRequirement,
  type SourceSpan,
} from "@/modules/agent-configuration";
import {
  defineCapability,
  type Analyzer,
  type Renderer,
} from "@/modules/skill-analysis";
import { ok } from "@/shared";
import type {
  AdapterWarning,
  AgentConfigurationImportAdapter,
  AgentConfigurationImportPreview,
  AgentConfigurationImportPreviewArtifact,
  ImportCollision,
  ImportEvidence,
  ImportRedaction,
  RuntimeDetection,
  SourceSnapshot,
} from "./agent-configuration-import.types";

const UTF8 = new TextDecoder("utf-8", { fatal: true });
const QUOTED_SECRET_ASSIGNMENT =
  /(^|[\s{,])(["']?)((?:[A-Za-z][A-Za-z0-9_-]*)?(?:key|token|secret|password|credential)[A-Za-z0-9_-]*)\2(\s*[:=]\s*)(["'])((?:\\.|[^\\\r\n])*?)\5/gim;
const BARE_SECRET_ASSIGNMENT =
  /(^|[\s{,])(["']?)((?:[A-Za-z][A-Za-z0-9_-]*)?(?:key|token|secret|password|credential)[A-Za-z0-9_-]*)\2(\s*[:=]\s*)(?!["'])([^\s,}\]]+)/gim;
const SECRET_REFERENCE =
  /\$\{((?:[A-Z][A-Z0-9_]*)?(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)[A-Z0-9_]*)\}/g;

type SanitizedFile = {
  path: string;
  content: string;
  encoding: "utf8" | "base64";
  byteLength: number;
  redactions: ImportRedaction[];
  requirements: SecretRequirement[];
};

function wholeFileSpan(bytes: Uint8Array): SourceSpan {
  let line = 1;
  let column = 1;
  for (const byte of bytes) {
    if (byte === 10) {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }
  return { startLine: 1, startColumn: 1, endLine: line, endColumn: column };
}

function positionAt(text: string, offset: number): { line: number; column: number } {
  const prefix = text.slice(0, offset);
  const lines = prefix.split("\n");
  return { line: lines.length, column: (lines.at(-1)?.length ?? 0) + 1 };
}

function spanAt(text: string, start: number, end: number): SourceSpan {
  const from = positionAt(text, start);
  const to = positionAt(text, end);
  return {
    startLine: from.line,
    startColumn: from.column,
    endLine: to.line,
    endColumn: to.column,
  };
}

function requirementName(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .toUpperCase();
}

function sanitize(file: SourceSnapshot["files"][number]): SanitizedFile {
  let text: string;
  try {
    text = UTF8.decode(file.bytes);
  } catch {
    return {
      path: file.path,
      content: Buffer.from(file.bytes).toString("base64"),
      encoding: "base64",
      byteLength: file.bytes.byteLength,
      redactions: [],
      requirements: [],
    };
  }

  const redactions: ImportRedaction[] = [];
  const requirements: SecretRequirement[] = [];
  for (const match of text.matchAll(SECRET_REFERENCE)) {
    requirements.push({
      name: match[1]!,
      purpose: `Required by ${file.path}`,
    });
  }

  const assignments: {
    start: number;
    end: number;
    valueStart: number;
    valueEnd: number;
    rawName: string;
    value: string;
  }[] = [];
  for (const pattern of [QUOTED_SECRET_ASSIGNMENT, BARE_SECRET_ASSIGNMENT]) {
    for (const match of text.matchAll(pattern)) {
      const prefix = match[1]!;
      const keyQuote = match[2]!;
      const rawName = match[3]!;
      const assignment = match[4]!;
      const valueQuote = pattern === QUOTED_SECRET_ASSIGNMENT ? match[5]! : "";
      const value = pattern === QUOTED_SECRET_ASSIGNMENT ? match[6]! : match[5]!;
      const start = match.index + prefix.length;
      const valueStart = start
        + keyQuote.length
        + rawName.length
        + keyQuote.length
        + assignment.length
        + valueQuote.length;
      assignments.push({
        start,
        end: match.index + match[0].length,
        valueStart,
        valueEnd: valueStart + value.length,
        rawName,
        value,
      });
    }
  }
  const uniqueAssignments = [...new Map(assignments.map((item) => [
    `${item.valueStart}:${item.valueEnd}`,
    item,
  ])).values()].sort((a, b) => a.valueStart - b.valueStart);

  for (const assignment of uniqueAssignments) {
    const { rawName, value, start, end } = assignment;
    if (value === "<redacted>" || /^\$\{[A-Z][A-Z0-9_]*\}$/.test(value)) continue;
      const name = requirementName(rawName);
      redactions.push({
        name,
        purpose: `Imported ${rawName} setting`,
        evidence: {
          path: file.path,
          span: spanAt(text, start, end),
        },
      });
      requirements.push({ name, purpose: `Imported ${rawName} setting` });
  }
  let content = text;
  for (const assignment of [...uniqueAssignments].reverse()) {
    if (
      assignment.value === "<redacted>"
      || /^\$\{[A-Z][A-Z0-9_]*\}$/.test(assignment.value)
    ) continue;
    content = `${content.slice(0, assignment.valueStart)}<redacted>${content.slice(assignment.valueEnd)}`;
  }

  return {
    path: file.path,
    content,
    encoding: "utf8",
    byteLength: file.bytes.byteLength,
    redactions,
    requirements,
  };
}

function stableComponentId(runtime: string, kind: AgentComponentKind, evidence: ImportEvidence): string {
  const key = `${runtime}\0${kind}\0${evidence.path}\0${JSON.stringify(evidence.span)}`;
  return `import-${createHash("sha256").update(key).digest("hex").slice(0, 20)}`;
}

function uniqueRequirements(requirements: readonly SecretRequirement[]): SecretRequirement[] {
  const byName = new Map<string, SecretRequirement>();
  for (const item of requirements) {
    if (!byName.has(item.name)) byName.set(item.name, item);
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function collisionsFor(
  imported: readonly { runtime: RuntimeDetection["runtime"]; component: AgentComponent }[],
): ImportCollision[] {
  const groups = new Map<string, typeof imported>();
  for (const item of imported) {
    const key = `${item.component.path}\0${item.component.kind}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return [...groups.values()]
    .filter((items) => new Set(items.map((item) => item.runtime)).size > 1)
    .map((items) => ({
      path: items[0]!.component.path,
      componentKind: items[0]!.component.kind,
      runtimes: [...new Set(items.map((item) => item.runtime))].sort(),
      evidence: items.map((item) => ({
        path: item.component.path,
        span: item.component.span!,
      })),
    }))
    .sort((a, b) => `${a.path}:${a.componentKind}`.localeCompare(`${b.path}:${b.componentKind}`));
}

export function createAgentConfigurationImportPreviewAnalyzer(
  adapters: readonly AgentConfigurationImportAdapter[],
): Analyzer<SourceSnapshot, AgentConfigurationImportPreviewArtifact> {
  return {
    kind: "agent-configuration-import-preview",
    async analyze(snapshot) {
      const sanitized = snapshot.files.map(sanitize);
      const runtimes: RuntimeDetection[] = [];
      const warnings: AdapterWarning[] = [];
      const imported: { runtime: RuntimeDetection["runtime"]; component: AgentComponent }[] = [];
      const adapterRequirements: SecretRequirement[] = [];

      for (const adapter of [...adapters].sort((a, b) => a.id.localeCompare(b.id))) {
        const probe = adapter.probe(snapshot);
        if (!probe.detected) continue;
        runtimes.push({
          runtime: adapter.runtime,
          adapter: { id: adapter.id, version: adapter.version },
          evidence: [...probe.evidence].sort(compareEvidence),
        });
        const result = adapter.import(snapshot, probe);
        warnings.push(...result.warnings);
        adapterRequirements.push(...(result.secretRequirements ?? []));
        for (const component of result.components) {
          imported.push({
            runtime: adapter.runtime,
            component: {
              id: stableComponentId(adapter.runtime, component.kind, component.evidence),
              kind: component.kind,
              path: component.evidence.path,
              span: component.evidence.span,
              contentHash: "",
            },
          });
        }
      }

      const components = imported
        .map(({ component }) => {
          const { contentHash: _contentHash, ...withoutHash } = component;
          return withoutHash;
        })
        .sort((a, b) => `${a.path}:${a.kind}:${a.id}`.localeCompare(`${b.path}:${b.kind}:${b.id}`));
      const requirements = uniqueRequirements([
        ...sanitized.flatMap((file) => file.requirements),
        ...adapterRequirements,
      ]);
      const configurationSnapshot = makeAgentConfigurationSnapshot({
        files: sanitized.map(({ path, content, encoding }) => ({ path, content, encoding })),
        components,
        secretRequirements: requirements,
      });
      const componentsByPath = new Map<string, string[]>();
      for (const component of configurationSnapshot.components) {
        componentsByPath.set(component.path, [
          ...(componentsByPath.get(component.path) ?? []),
          component.id,
        ]);
      }

      return ok({
        kind: "agent-configuration-import-preview",
        snapshot: configurationSnapshot,
        runtimes: runtimes.sort((a, b) => a.runtime.localeCompare(b.runtime)),
        sourceFiles: configurationSnapshot.files.map((file) => ({
          path: file.path,
          encoding: file.encoding,
          byteLength: sanitized.find((candidate) => candidate.path === file.path)!.byteLength,
          contentHash: file.contentHash,
          componentIds: (componentsByPath.get(file.path) ?? []).sort(),
          classification: componentsByPath.has(file.path) ? "classified" : "unclassified",
        })),
        redactions: sanitized.flatMap((file) => file.redactions).sort(compareRedaction),
        warnings: warnings.sort((a, b) => compareEvidence(a.evidence, b.evidence) || a.code.localeCompare(b.code)),
        collisions: collisionsFor(imported),
      });
    },
  };
}

const previewRenderer: Renderer<
  AgentConfigurationImportPreviewArtifact,
  AgentConfigurationImportPreview
> = {
  target: "preview",
  render: (artifact) => artifact,
};

export function createAgentConfigurationImportPreviewCapability(
  adapters: readonly AgentConfigurationImportAdapter[],
) {
  return defineCapability({
    name: "Agent configuration import preview",
    analyzer: createAgentConfigurationImportPreviewAnalyzer(adapters),
    renderers: { preview: previewRenderer },
  });
}

function compareEvidence(a: ImportEvidence, b: ImportEvidence): number {
  return a.path.localeCompare(b.path)
    || a.span.startLine - b.span.startLine
    || a.span.startColumn - b.span.startColumn;
}

function compareRedaction(a: ImportRedaction, b: ImportRedaction): number {
  return compareEvidence(a.evidence, b.evidence) || a.name.localeCompare(b.name);
}

export const sourceSpanForWholeFile = wholeFileSpan;
