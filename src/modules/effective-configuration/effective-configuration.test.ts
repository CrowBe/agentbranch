import { describe, expect, it } from "vitest";
import { makeAgentConfigurationSnapshot } from "@/modules/agent-configuration";
import { unwrap } from "@/shared";
import { runCapability } from "@/modules/skill-analysis";
import {
  effectiveConfigurationCapability,
  resolveEffectiveConfiguration,
  type EffectiveConfigurationRelationshipKind,
  type EffectiveConfigurationResolutionRule,
} from ".";

const span = {
  startLine: 1,
  startColumn: 1,
  endLine: 1,
  endColumn: 12,
};

function snapshot() {
  return makeAgentConfigurationSnapshot({
    files: [
      { path: "AGENTS.md", content: "Project rules." },
      { path: "nested/AGENTS.md", content: "Nested rules." },
      { path: "skills/review.md", content: "Review rules." },
      { path: "skills/review-copy.md", content: "Review rules." },
      { path: "agents/reviewer.md", content: "Reviewer rules." },
      { path: "tools/shell.json", content: "{\"shell\":1}" },
      { path: "model.json", content: "{\"model\":1}" },
      { path: "policy.json", content: "{\"policy\":1}" },
      { path: "orphan.md", content: "Orphan data." },
    ],
    components: [
      { id: "root", kind: "instruction", path: "AGENTS.md", span },
      { id: "nested", kind: "instruction", path: "nested/AGENTS.md", span },
      { id: "review", kind: "skill", path: "skills/review.md", span },
      { id: "review-copy", kind: "skill", path: "skills/review-copy.md", span },
      { id: "reviewer", kind: "subagent", path: "agents/reviewer.md", span },
      { id: "shell", kind: "tool", path: "tools/shell.json", span },
      { id: "model", kind: "model", path: "model.json", span },
      { id: "policy", kind: "policy", path: "policy.json", span },
      { id: "orphan", kind: "unknown", path: "orphan.md", span },
    ],
  });
}

const allRelationshipKinds: readonly EffectiveConfigurationRelationshipKind[] = [
  "loads",
  "overrides",
  "references",
  "selects",
  "delegates-to",
  "permits",
  "requires",
  "unknown",
];

function rules(): EffectiveConfigurationResolutionRule[] {
  return [
    {
      componentId: "root",
      adapterRule: "test.instructions.root",
      label: "Root instructions",
      declaration: "instructions",
      precedence: 10,
      instructionOrder: 1,
      root: true,
      relationships: [
        { kind: "loads", target: "review", confidence: "certain" },
        { kind: "references", target: "missing.md", confidence: "certain" },
        { kind: "selects", target: "model", confidence: "certain" },
        { kind: "delegates-to", target: "reviewer", confidence: "certain" },
        { kind: "permits", target: "shell", confidence: "certain" },
        { kind: "requires", target: "policy", confidence: "certain" },
        { kind: "unknown", target: "review-name", confidence: "ambiguous" },
      ],
    },
    {
      componentId: "nested",
      adapterRule: "test.instructions.nested",
      label: "Nested instructions",
      declaration: "instructions",
      precedence: 20,
      instructionOrder: 2,
      root: true,
      relationships: [{ kind: "overrides", target: "root", confidence: "certain" }],
    },
    {
      componentId: "review",
      adapterRule: "test.skill",
      label: "review-name",
      declaration: "skill:review",
      precedence: 10,
    },
    {
      componentId: "review-copy",
      adapterRule: "test.skill-copy",
      label: "review-name",
      declaration: "skill:review",
      precedence: 10,
    },
    { componentId: "reviewer", adapterRule: "test.subagent", label: "reviewer" },
    { componentId: "shell", adapterRule: "test.tool", label: "shell" },
    { componentId: "model", adapterRule: "test.model", label: "model", root: true },
    { componentId: "policy", adapterRule: "test.policy", label: "policy", root: true },
    { componentId: "orphan", adapterRule: "test.unknown", label: "orphan" },
  ];
}

describe("effective configuration resolver", () => {
  it("keeps the complete runtime-neutral relationship vocabulary source-grounded", () => {
    const graph = resolveEffectiveConfiguration({ snapshot: snapshot(), rules: rules() });

    expect([...new Set(graph.edges.map((edge) => edge.kind))].sort())
      .toEqual([...allRelationshipKinds].sort());
    expect(graph.nodes.every((node) =>
      node.evidence.path
      && node.evidence.span.startLine > 0
      && node.evidence.adapterRule
      && node.evidence.confidence
    )).toBe(true);
    expect(graph.edges.every((edge) =>
      edge.evidence.path
      && edge.evidence.span.startLine > 0
      && edge.evidence.adapterRule
      && edge.evidence.confidence
    )).toBe(true);
  });

  it("surfaces shadows, duplicates, ambiguity, unresolved targets, and unreachable nodes", () => {
    const graph = resolveEffectiveConfiguration({ snapshot: snapshot(), rules: rules() });
    const codes = graph.findings.map((finding) => finding.code);

    expect(codes).toEqual(expect.arrayContaining([
      "shadowed-instruction",
      "duplicate-declaration",
      "ambiguous-precedence",
      "unresolved-reference",
      "ambiguous-relationship",
      "unreachable-component",
    ]));
    expect(graph.nodes.find((node) => node.componentId === "root")?.effective).toBe(false);
    expect(graph.edges.find((edge) => edge.target === "missing.md")?.status).toBe("unresolved");
    expect(graph.edges.find((edge) => edge.kind === "unknown")?.status).toBe("ambiguous");
  });

  it("answers which instructions, skills, tools, model settings, and policies are effective", async () => {
    const graph = resolveEffectiveConfiguration({ snapshot: snapshot(), rules: rules() });

    expect(graph.effective.instructions).toEqual(["component:nested"]);
    expect(graph.effective.skills).toHaveLength(2);
    expect(graph.effective.tools).toEqual(["component:shell"]);
    expect(graph.effective.modelSettings).toEqual(["component:model"]);
    expect(graph.effective.policies).toEqual(["component:policy"]);

    const outline = unwrap(await runCapability(
      effectiveConfigurationCapability,
      "outline",
      { snapshot: snapshot(), rules: rules() },
    ));
    expect(outline.instructionOrder.map((item) => item.label)).toEqual([
      "Nested instructions",
    ]);
    expect(outline.rows.find((row) => row.component === "Root instructions")?.status)
      .toBe("shadowed");
  });

  it("finds disconnected relationship subgraphs by traversing from effective roots", () => {
    const isolated = makeAgentConfigurationSnapshot({
      files: [
        { path: "root.md", content: "Root." },
        { path: "a.md", content: "A." },
        { path: "b.md", content: "B." },
      ],
      components: [
        { id: "root", kind: "instruction", path: "root.md", span: { ...span, endColumn: 6 } },
        { id: "a", kind: "skill", path: "a.md", span: { ...span, endColumn: 3 } },
        { id: "b", kind: "skill", path: "b.md", span: { ...span, endColumn: 3 } },
      ],
    });
    const graph = resolveEffectiveConfiguration({
      snapshot: isolated,
      rules: [
        { componentId: "root", adapterRule: "test.root", root: true },
        {
          componentId: "a",
          adapterRule: "test.a",
          relationships: [{ kind: "loads", target: "b", confidence: "certain" }],
        },
        { componentId: "b", adapterRule: "test.b" },
      ],
    });

    expect(graph.findings.filter((finding) => finding.code === "unreachable-component")
      .flatMap((finding) => finding.nodeIds).sort()).toEqual(["component:a", "component:b"]);
  });

  it("does not make components reachable through a shadowed root", () => {
    const shadowedRoot = makeAgentConfigurationSnapshot({
      files: [
        { path: "root.md", content: "Root." },
        { path: "shadowed.md", content: "Shadowed." },
        { path: "orphan.md", content: "Orphan." },
      ],
      components: [
        { id: "root", kind: "instruction", path: "root.md", span: { ...span, endColumn: 6 } },
        {
          id: "shadowed",
          kind: "instruction",
          path: "shadowed.md",
          span: { ...span, endColumn: 10 },
        },
        { id: "orphan", kind: "skill", path: "orphan.md", span: { ...span, endColumn: 8 } },
      ],
    });
    const graph = resolveEffectiveConfiguration({
      snapshot: shadowedRoot,
      rules: [
        {
          componentId: "root",
          adapterRule: "test.root",
          declaration: "instructions",
          precedence: 2,
          root: true,
        },
        {
          componentId: "shadowed",
          adapterRule: "test.shadowed",
          declaration: "instructions",
          precedence: 1,
          root: true,
          relationships: [{ kind: "loads", target: "orphan", confidence: "certain" }],
        },
        { componentId: "orphan", adapterRule: "test.orphan" },
      ],
    });

    expect(graph.findings.filter((finding) => finding.code === "unreachable-component")
      .flatMap((finding) => finding.nodeIds)).toContain("component:orphan");
  });

  it("uses stable, occurrence-unique IDs for duplicate relationships", () => {
    const duplicateRules = rules().map((rule) => rule.componentId === "root"
      ? {
          ...rule,
          relationships: [
            { kind: "requires" as const, target: "policy", confidence: "certain" as const },
            { kind: "requires" as const, target: "policy", confidence: "certain" as const },
          ],
        }
      : rule);
    const first = resolveEffectiveConfiguration({ snapshot: snapshot(), rules: duplicateRules });
    const second = resolveEffectiveConfiguration({ snapshot: snapshot(), rules: duplicateRules });
    const firstIds = first.edges.filter((edge) => edge.kind === "requires").map((edge) => edge.id);
    const secondIds = second.edges.filter((edge) => edge.kind === "requires").map((edge) => edge.id);

    expect(new Set(firstIds).size).toBe(2);
    expect(firstIds).toEqual(secondIds);
  });

  it("preserves duplicate explicit overrides declarations as occurrence-unique outline relationships", async () => {
    const duplicateRules = rules().map((rule) => rule.componentId === "root"
      ? {
          ...rule,
          relationships: [
            { kind: "overrides" as const, target: "policy", confidence: "certain" as const },
            { kind: "overrides" as const, target: "policy", confidence: "certain" as const },
          ],
        }
      : rule);
    const first = resolveEffectiveConfiguration({ snapshot: snapshot(), rules: duplicateRules });
    const second = resolveEffectiveConfiguration({ snapshot: snapshot(), rules: duplicateRules });
    const firstIds = first.edges
      .filter((edge) => edge.kind === "overrides" && edge.from === "component:root" && edge.target === "policy")
      .map((edge) => edge.id);
    const secondIds = second.edges
      .filter((edge) => edge.kind === "overrides" && edge.from === "component:root" && edge.target === "policy")
      .map((edge) => edge.id);
    const outline = unwrap(await runCapability(
      effectiveConfigurationCapability,
      "outline",
      { snapshot: snapshot(), rules: duplicateRules },
    ));
    const outlineIds = outline.relationships
      .filter((relationship) =>
        relationship.relationship === "overrides"
        && relationship.source === "Root instructions"
        && relationship.target === "policy",
      )
      .map((relationship) => relationship.id);

    expect(firstIds).toHaveLength(2);
    expect(new Set(firstIds).size).toBe(2);
    expect(firstIds).toEqual(secondIds);
    expect(outlineIds).toEqual(firstIds);
    expect(new Set(outlineIds).size).toBe(2);
  });

  it("rejects an out-of-bounds relationship span", () => {
    expect(() => resolveEffectiveConfiguration({
      snapshot: snapshot(),
      rules: rules().map((rule) => rule.componentId === "root"
        ? {
            ...rule,
            relationships: [{
              kind: "loads" as const,
              target: "review",
              confidence: "certain" as const,
              span: { startLine: 77, startColumn: 1, endLine: 88, endColumn: 1 },
            }],
          }
        : rule),
    })).toThrow(/relationship.*invalid source span/i);
  });
});
