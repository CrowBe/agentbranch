import { createHash } from "node:crypto";
import { defineCapability, type Analyzer, type Renderer } from "@/modules/skill-analysis";
import { ok } from "@/shared";
import type { SourceSpan } from "@/modules/agent-configuration";
import type { ProfileAnalysis, ProfileAnalysisInput, ProfileBreakdown, ProfileEvidence, ProfileFinding, ProfileFindingCode, ProfileFindingSeverity, ProfileInsights } from "./profile-analysis.types";

const span = (content: string, needle: string) => { const at = Math.max(0, content.indexOf(needle)); const before = content.slice(0, at).split("\n"); return { startLine: before.length, startColumn: before.at(-1)!.length + 1, endLine: before.length, endColumn: before.at(-1)!.length + needle.length + 1 }; };
const id = (code: ProfileFindingCode, evidence: ProfileEvidence[]) => `profile-${createHash("sha256").update(`${code}\0${evidence.map((item) => `${item.path}:${item.span.startLine}:${item.excerpt}`).join("\0")}`).digest("hex").slice(0, 16)}`;
const severityPenalty: Record<ProfileFindingSeverity, number> = { error: 20, warn: 10, info: 3 };

function evidence(path: string, content: string, excerpt: string): ProfileEvidence { return { path, span: span(content, excerpt), excerpt }; }
function add(found: ProfileFinding[], code: ProfileFindingCode, severity: ProfileFindingSeverity, rationale: string, affectedEffectiveBehavior: string, fix: string, items: ProfileEvidence[]) { found.push({ id: id(code, items), code, severity, rationale, affectedEffectiveBehavior, fix, evidence: items, suppressed: false }); }

function offsetsForSpan(content: string, source: SourceSpan): { start: number; end: number } | undefined {
  const lines = content.split("\n");
  const offset = (line: number, column: number) => {
    if (line < 1 || line > lines.length || column < 1 || column > lines[line - 1]!.length + 1) return undefined;
    return lines.slice(0, line - 1).reduce((total, item) => total + item.length + 1, 0) + column - 1;
  };
  const start = offset(source.startLine, source.startColumn), end = offset(source.endLine, source.endColumn);
  return start === undefined || end === undefined || end <= start ? undefined : { start, end };
}

function excerptForSpan(content: string, source: SourceSpan): string | undefined {
  const offsets = offsetsForSpan(content, source);
  return offsets ? content.slice(offsets.start, offsets.end) : undefined;
}

function overlaps(a: SourceSpan, b: SourceSpan, content: string): boolean {
  const left = offsetsForSpan(content, a), right = offsetsForSpan(content, b);
  return !!left && !!right && left.start < right.end && right.start < left.end;
}

function validSuppression(item: ProfileFinding, rationale: ProfileEvidence, files: ReadonlyMap<string, string>): boolean {
  const content = files.get(rationale.path);
  if (!content || !rationale.excerpt.trim() || excerptForSpan(content, rationale.span) !== rationale.excerpt) return false;
  return item.evidence.some((source) => source.path === rationale.path && overlaps(source.span, rationale.span, content));
}

export function analyzeProfile(input: ProfileAnalysisInput): ProfileAnalysis {
  const files = new Map(input.snapshot.files.filter((file) => file.encoding === "utf8").map((file) => [file.path, file.content]));
  const nodes = input.graph.nodes.filter((node) => node.effective);
  const found: ProfileFinding[] = [];
  const instructions = nodes.filter((node) => node.kind === "instruction");
  for (let i = 0; i < instructions.length; i++) for (let j = i + 1; j < instructions.length; j++) {
    const a = instructions[i]!, b = instructions[j]!, ac = files.get(a.evidence.path) ?? "", bc = files.get(b.evidence.path) ?? "";
    if (ac.trim() && ac.trim() === bc.trim()) add(found, "duplicated-instruction", "warn", "Two effective instructions have identical source text.", "Both instructions are loaded into the effective instruction set.", "Keep one source of truth or make their responsibilities distinct.", [evidence(a.evidence.path, ac, ac.trim()), evidence(b.evidence.path, bc, bc.trim())]);
    const subject = /(?:always|never)\s+(.+)/i; const am = ac.match(subject), bm = bc.match(subject);
    if (am && bm && am[1]!.toLowerCase() === bm[1]!.toLowerCase() && /^always/i.test(ac) !== /^always/i.test(bc)) add(found, "contradictory-instruction", "error", "Effective instructions make opposing explicit directives.", "An agent cannot satisfy both directives in the assembled instruction order.", "Choose one directive or state an explicit precedence rule.", [evidence(a.evidence.path, ac, am[0]), evidence(b.evidence.path, bc, bm[0])]);
  }
  const contextBytes = [...nodes].reduce((total, node) => total + Buffer.byteLength(files.get(node.evidence.path) ?? ""), 0);
  if (contextBytes > 12000) { const node = nodes.find((item) => Buffer.byteLength(files.get(item.evidence.path) ?? "") > 4000) ?? nodes[0]; if (node) { const content = files.get(node.evidence.path) ?? ""; add(found, "excessive-context", "warn", `Effective source totals ${contextBytes} bytes, above the 12000-byte deterministic budget.`, "Large assembled context can crowd out task-specific instructions.", "Split or shorten the largest effective sources.", [evidence(node.evidence.path, content, content.slice(0, Math.min(80, content.length)))]); } }
  const skills = nodes.filter((node) => node.kind === "skill");
  for (let i = 0; i < skills.length; i++) for (let j = i + 1; j < skills.length; j++) { const a = skills[i]!, b = skills[j]!, ac = files.get(a.evidence.path) ?? "", bc = files.get(b.evidence.path) ?? ""; const trigger = (text: string) => text.match(/(?:trigger|description)\s*:\s*([^\n]+)/i)?.[1]?.trim().toLowerCase(); if (trigger(ac) && trigger(ac) === trigger(bc)) add(found, "overlapping-skill-trigger", "warn", "Two effective skills declare the same trigger text.", "Selection between these skills is ambiguous from the assembled configuration.", "Give each skill a distinct trigger or document a source-grounded selection rule.", [evidence(a.evidence.path, ac, trigger(ac)!), evidence(b.evidence.path, bc, trigger(bc)!)]); }
  for (const structural of input.graph.findings) { const code: ProfileFindingCode | undefined = structural.code === "unreachable-component" ? "unreachable-component" : structural.code === "unresolved-reference" ? "missing-reference" : undefined; if (code) { const content = files.get(structural.evidence.path) ?? ""; const excerpt = excerptForSpan(content, structural.evidence.span); if (excerpt) add(found, code, "warn", structural.message, code === "unreachable-component" ? "The component is not reached by the effective graph." : "The effective graph cannot resolve this reference.", code === "unreachable-component" ? "Add a source-grounded load/reference path or remove the component." : "Correct the target or add the referenced component.", [{ path: structural.evidence.path, span: structural.evidence.span, excerpt }]); } }
  for (const node of nodes) { const content = files.get(node.evidence.path) ?? ""; if (/allow\s+(?:delete|shell|network)|destructive/i.test(content) && /(?:tool|policy)/.test(node.kind)) add(found, "unsafe-capability-combination", "error", "Source explicitly permits a potentially destructive capability.", "The effective configuration grants the named capability without a narrower source-grounded boundary.", "Require a constrained policy, confirmation, or remove the permission.", [evidence(node.evidence.path, content, content.match(/[^\n]*(?:allow\s+(?:delete|shell|network)|destructive)[^\n]*/i)?.[0] ?? content.slice(0, 80))]); if (/\b(?:anthropic|openai|claude|gpt-[\w.-]+)\b/i.test(content)) add(found, "hidden-provider-assumption", "warn", "Source names a provider or model without a runtime-neutral selection boundary.", "Effective behavior may depend on an unavailable provider or model.", "Declare the requirement at an adapter boundary or make the instruction provider-neutral.", [evidence(node.evidence.path, content, content.match(/\b(?:anthropic|openai|claude|gpt-[\w.-]+)\b/i)![0])]); if (Buffer.byteLength(content) > 4000) add(found, "token-cost-hotspot", "warn", `This effective source is ${Buffer.byteLength(content)} bytes.`, "This source is included in assembled context and is a likely token-cost hotspot.", "Condense repeated material or load it only when needed.", [evidence(node.evidence.path, content, content.slice(0, 80))]); }
  const suppressions = new Map((input.suppressions ?? []).map((item) => [item.findingId, item]));
  const findings = found.map((item) => { const suppression = suppressions.get(item.id); if (!suppression || !validSuppression(item, suppression.rationale, files)) return item; return { ...item, suppressed: true, suppressionRationale: suppression.rationale }; });
  const score = Math.max(0, 100 - findings.filter((item) => !item.suppressed).reduce((total, item) => total + severityPenalty[item.severity], 0));
  return { kind: "profile-analysis", score, findings: findings.sort((a, b) => a.id.localeCompare(b.id)), modelAssistedJudgments: [] };
}
export const profileAnalysisAnalyzer: Analyzer<ProfileAnalysisInput, ProfileAnalysis> = { kind: "profile-analysis", async analyze(input) { return ok(analyzeProfile(input)); } };
export const profileInsightsRenderer: Renderer<ProfileAnalysis, ProfileInsights> = { target: "insights", render: (artifact) => ({ score: artifact.score, summary: artifact.findings.some((item) => !item.suppressed) ? `Profile quality is ${artifact.score}/100; fix unsuppressed errors first.` : "The assembled profile has no unsuppressed deterministic findings.", findings: artifact.findings.filter((item) => !item.suppressed && item.severity === "error").map((item) => item.fix), watch: artifact.findings.filter((item) => !item.suppressed && item.severity !== "error").map((item) => item.fix) }) };
export const profileBreakdownRenderer: Renderer<ProfileAnalysis, ProfileBreakdown> = { target: "breakdown", render: (artifact) => ({ score: artifact.score, findings: artifact.findings }) };
export const profileAnalysisCapability = defineCapability({ name: "Profile analysis", analyzer: profileAnalysisAnalyzer, renderers: { insights: profileInsightsRenderer, breakdown: profileBreakdownRenderer } });
