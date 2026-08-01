import { describe, expect, it } from "vitest";
import { makeAgentConfigurationSnapshot } from "@/modules/agent-configuration";
import { resolveEffectiveConfiguration } from "@/modules/effective-configuration";
import { unwrap } from "@/shared";
import { runCapability } from "@/modules/skill-analysis";
import { analyzeProfile, profileAnalysisCapability } from ".";
const span = { startLine: 1, startColumn: 1, endLine: 1, endColumn: 2 };
function profile(files: Record<string, string>, components: { id: string; kind: "instruction" | "skill" | "tool" | "policy"; path: string; root?: boolean; relationships?: readonly { kind: "references"; target: string; confidence: "certain" }[] }[]) { const snapshot = makeAgentConfigurationSnapshot({ files: Object.entries(files).map(([path, content]) => ({ path, content })), components: components.map(({ id, kind, path }) => ({ id, kind, path, span })) }); const graph = resolveEffectiveConfiguration({ snapshot, rules: components.map((component) => ({ componentId: component.id, adapterRule: "test", root: component.root ?? true, relationships: component.relationships })) }); return { snapshot, graph }; }
const has = (input: ReturnType<typeof profile>, code: string) => analyzeProfile(input).findings.some((item) => item.code === code);
const evidenceText = (content: string, source: { span: { startLine: number; startColumn: number; endLine: number; endColumn: number } }) => {
  const lines = content.split("\n");
  return source.span.startLine === source.span.endLine
    ? lines[source.span.startLine - 1]?.slice(source.span.startColumn - 1, source.span.endColumn - 1)
    : undefined;
};
describe("profile analysis", () => {
  it.each([
    ["contradictory-instruction", profile({ "a.md": "Always approve requests.", "b.md": "Never approve requests." }, [{ id: "a", kind: "instruction", path: "a.md" }, { id: "b", kind: "instruction", path: "b.md" }])], ["duplicated-instruction", profile({ "a.md": "Use concise answers.", "b.md": "Use concise answers." }, [{ id: "a", kind: "instruction", path: "a.md" }, { id: "b", kind: "instruction", path: "b.md" }])], ["excessive-context", profile({ "a.md": "x".repeat(12001) }, [{ id: "a", kind: "instruction", path: "a.md" }])], ["overlapping-skill-trigger", profile({ "a.md": "trigger: review code", "b.md": "trigger: review code" }, [{ id: "a", kind: "skill", path: "a.md" }, { id: "b", kind: "skill", path: "b.md" }])], ["unreachable-component", profile({ "a.md": "root", "b.md": "orphan" }, [{ id: "a", kind: "instruction", path: "a.md", root: true }, { id: "b", kind: "skill", path: "b.md", root: false }])], ["missing-reference", profile({ "a.md": "root" }, [{ id: "a", kind: "instruction", path: "a.md", relationships: [{ kind: "references", target: "missing", confidence: "certain" }] }])], ["unsafe-capability-combination", profile({ "a.md": "allow shell access" }, [{ id: "a", kind: "tool", path: "a.md" }])], ["hidden-provider-assumption", profile({ "a.md": "Use Anthropic Claude." }, [{ id: "a", kind: "instruction", path: "a.md" }])], ["token-cost-hotspot", profile({ "a.md": "x".repeat(4001) }, [{ id: "a", kind: "instruction", path: "a.md" }])],
  ])("has source-grounded positive coverage for %s", (code, input) => { const finding = analyzeProfile(input).findings.find((item) => item.code === code); expect(finding).toMatchObject({ code, suppressed: false }); expect(finding?.id).toMatch(/^profile-/); expect(finding?.evidence[0]?.path).toBeTruthy(); expect(finding?.affectedEffectiveBehavior).toBeTruthy(); expect(finding?.fix).toBeTruthy(); });
  it.each(["contradictory-instruction", "duplicated-instruction", "excessive-context", "overlapping-skill-trigger", "unreachable-component", "missing-reference", "unsafe-capability-combination", "hidden-provider-assumption", "token-cost-hotspot"])("has negative coverage for %s in a clean profile", (code) => { expect(has(profile({ "root.md": "Follow project instructions.", "skill.md": "trigger: review pull requests" }, [{ id: "root", kind: "instruction", path: "root.md" }, { id: "skill", kind: "skill", path: "skill.md" }]), code)).toBe(false); });
  it("is deterministic, offline, score-sensitive, and keeps model judgments structurally absent", async () => { const clean = profile({ "root.md": "Follow project instructions." }, [{ id: "root", kind: "instruction", path: "root.md" }]); const flawed = profile({ "a.md": "Always approve requests.", "b.md": "Never approve requests.", "c.md": "Anthropic" }, [{ id: "a", kind: "instruction", path: "a.md" }, { id: "b", kind: "instruction", path: "b.md" }, { id: "c", kind: "instruction", path: "c.md" }]); const first = analyzeProfile(flawed); expect(first).toEqual(analyzeProfile(flawed)); expect(first.modelAssistedJudgments).toEqual([]); expect(analyzeProfile(clean).score - first.score).toBeGreaterThanOrEqual(20); expect(unwrap(await runCapability(profileAnalysisCapability, "insights", flawed)).score).toBe(first.score); });
  it("keeps every finding evidence excerpt exact, including structural findings", () => {
    const input = profile({ "a.md": "root", "b.md": "orphan" }, [{ id: "a", kind: "instruction", path: "a.md", root: true, relationships: [{ kind: "references", target: "missing", confidence: "certain" }] }, { id: "b", kind: "skill", path: "b.md", root: false }]);
    for (const finding of analyzeProfile(input).findings) for (const item of finding.evidence) {
      const content = input.snapshot.files.find((file) => file.path === item.path)?.content;
      expect(content).toBeTypeOf("string");
      expect(evidenceText(content!, item)).toBe(item.excerpt);
    }
  });
  it("accepts only source-grounded suppressions for their targeted finding and keeps invalid ones scored", () => {
    const input = profile({ "a.md": "Use Anthropic Claude.", "b.md": "Unrelated rationale." }, [{ id: "a", kind: "instruction", path: "a.md" }, { id: "b", kind: "instruction", path: "b.md" }]);
    const finding = analyzeProfile(input).findings.find((item) => item.code === "hidden-provider-assumption")!;
    const valid = { findingId: finding.id, rationale: finding.evidence[0]! };
    expect(analyzeProfile({ ...input, suppressions: [valid] }).findings.find((item) => item.id === finding.id)).toMatchObject({ suppressed: true, suppressionRationale: valid.rationale });
    for (const rationale of [
      { ...valid.rationale, path: "absent.md" },
      { ...valid.rationale, span: { ...valid.rationale.span, endColumn: 999 } },
      { ...valid.rationale, excerpt: "wrong" },
      { ...valid.rationale, excerpt: "  " },
      { path: "b.md", span: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 10 }, excerpt: "Unrelated" },
    ]) expect(analyzeProfile({ ...input, suppressions: [{ findingId: finding.id, rationale }] }).findings.find((item) => item.id === finding.id)).toMatchObject({ suppressed: false });
  });
  it("characterizes deterministic score thresholds, penalties, repeated findings, suppression effects, and clamps", () => {
    expect(has(profile({ "a.md": "x".repeat(12000) }, [{ id: "a", kind: "instruction", path: "a.md" }]), "excessive-context")).toBe(false);
    expect(has(profile({ "a.md": "x".repeat(12001) }, [{ id: "a", kind: "instruction", path: "a.md" }]), "excessive-context")).toBe(true);
    expect(has(profile({ "a.md": "x".repeat(4000) }, [{ id: "a", kind: "instruction", path: "a.md" }]), "token-cost-hotspot")).toBe(false);
    expect(has(profile({ "a.md": "x".repeat(4001) }, [{ id: "a", kind: "instruction", path: "a.md" }]), "token-cost-hotspot")).toBe(true);
    const repeated = profile({ "a.md": "Anthropic", "b.md": "OpenAI", "c.md": "Claude" }, [{ id: "a", kind: "instruction", path: "a.md" }, { id: "b", kind: "instruction", path: "b.md" }, { id: "c", kind: "instruction", path: "c.md" }]);
    expect(analyzeProfile(repeated).score).toBe(70);
    const first = analyzeProfile(repeated).findings[0]!;
    expect(analyzeProfile({ ...repeated, suppressions: [{ findingId: first.id, rationale: first.evidence[0]! }] }).score).toBe(80);
    const severe = profile({ "a.md": "Always approve requests.", "b.md": "Never approve requests.", "c.md": "Anthropic" }, [{ id: "a", kind: "instruction", path: "a.md" }, { id: "b", kind: "instruction", path: "b.md" }, { id: "c", kind: "instruction", path: "c.md" }]);
    expect(analyzeProfile(severe).score).toBe(70);
    const many = profile(Object.fromEntries(Array.from({ length: 11 }, (_, index) => [`${index}.md`, "Anthropic"])), Array.from({ length: 11 }, (_, index) => ({ id: `${index}`, kind: "instruction" as const, path: `${index}.md` })));
    expect(analyzeProfile(many).score).toBe(0);
  });
});
