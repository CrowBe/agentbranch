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
      { path: "skills/review.md", content: "Review." },
      { path: "skills/review-copy.md", content: "Review." },
      { path: "agents/reviewer.md", content: "Reviewer." },
      { path: "tools/shell.json", content: "{}" },
      { path: "model.json", content: "{}" },
      { path: "policy.json", content: "{}" },
      { path: "orphan.md", content: "Orphan." },
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
});
