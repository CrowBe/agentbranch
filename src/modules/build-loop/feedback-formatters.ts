import { contractCheckIssues, type TestRunResult, type TranscriptStep } from "@/modules/test-run";
import type { CaseResult, TriggeringResult } from "@/modules/triggering-eval";
import type { LintFinding, LintReport } from "@/modules/lint";
import type { ResponseSchemaLintReport } from "@/modules/response-schema";
import type { ToolContractLintReport } from "@/modules/tool-contract";

export function formatTriggeringEvalFeedback(result: TriggeringResult): string {
  const lines = [
    `Triggering eval - ${result.insight.verdict}`,
    "",
    result.insight.summary,
    "",
    ...formatList("What's working:", result.insight.findings),
    "",
    ...formatList("Watch:", result.insight.watch),
    "",
  ];

  const failedCases = result.cases.filter((caseResult) => !caseResult.pass);
  if (failedCases.length === 0) {
    lines.push(
      "All triggering eval cases passed.",
      "",
      "No revision is needed unless you want to make a deliberate change.",
    );
    return lines.join("\n");
  }

  lines.push(
    "Failed cases:",
    ...failedCases.flatMap(formatFailedCase),
    "",
    "Please revise the skill to address these triggering failures. The description and trigger surface are the primary targets.",
  );

  return lines.join("\n");
}

export function formatTestRunFeedback(result: TestRunResult): string {
  return [
    `Test run - ${result.insight.verdict}`,
    "",
    `Scenario: ${result.scenario.prompt}`,
    "",
    result.insight.summary,
    "",
    ...formatList("What's working:", result.insight.findings),
    "",
    ...formatList("Watch:", result.insight.watch),
    "",
    ...formatContractChecks(result),
    "Transcript:",
    ...result.transcript.map(formatTranscriptStep),
    "",
    "Please revise the skill to address this test-run evidence. The body workflow and instructions are the primary targets.",
  ].join("\n");
}

/** The bundle's relational evidence (Skill × Tool contract): deterministic
 * per-call validation against the supplied contracts. Empty lines for a
 * single-primitive run so the message shape is unchanged. */
function formatContractChecks(result: TestRunResult): string[] {
  if (result.contractChecks.length === 0) return [];
  const issues = contractCheckIssues(result.contractChecks);
  if (issues.length === 0) {
    return ["Tool-contract checks: every supplied contract was called with matching arguments and output.", ""];
  }
  return [...formatList("Tool-contract checks:", issues), ""];
}

export function formatLintFeedback(report: LintReport): string | null {
  if (report.findings.length === 0) return null;

  return [
    `Lint - Quality ${report.summary.grade} ${report.summary.score}/100`,
    "",
    "The deterministic lint pass found issues in the current SKILL.md.",
    "",
    ...formatLintSection("Errors:", report.findings, "error"),
    "",
    ...formatLintSection("Warnings:", report.findings, "warn"),
    "",
    ...formatLintSection("Info:", report.findings, "info"),
    "",
    "Please revise the skill to address these lint findings. Fix errors first, then tighten warnings.",
  ].join("\n");
}

export function formatResponseSchemaLintFeedback(report: ResponseSchemaLintReport): string | null {
  if (report.findings.length === 0) return null;

  return [
    `Lint - Quality ${report.summary.grade} ${report.summary.score}/100`,
    "",
    "The deterministic lint pass found issues in the current response schema.",
    "",
    ...formatLintSection("Errors:", report.findings, "error"),
    "",
    ...formatLintSection("Warnings:", report.findings, "warn"),
    "",
    ...formatLintSection("Info:", report.findings, "info"),
    "",
    "Please revise the response schema to address these lint findings. Fix errors first, then tighten warnings.",
  ].join("\n");
}

export function formatToolContractLintFeedback(report: ToolContractLintReport): string | null {
  if (report.findings.length === 0) return null;

  return [
    `Lint - Quality ${report.summary.grade} ${report.summary.score}/100`,
    "",
    "The deterministic lint pass found issues in the current tool contract.",
    "",
    ...formatLintSection("Errors:", report.findings, "error"),
    "",
    ...formatLintSection("Warnings:", report.findings, "warn"),
    "",
    ...formatLintSection("Info:", report.findings, "info"),
    "",
    "Please revise the tool contract to address these lint findings. Fix errors first, then tighten warnings.",
  ].join("\n");
}

function formatList(label: string, items: readonly string[]): string[] {
  if (items.length === 0) return [label, "- None."];
  return [label, ...items.map((item) => `- ${item}`)];
}

function formatLintSection(
  label: string,
  findings: readonly LintFinding[],
  severity: LintFinding["severity"],
): string[] {
  const matching = findings.filter((finding) => finding.severity === severity);
  if (matching.length === 0) return [label, "- None."];
  return [label, ...matching.map((finding) => `- ${finding.message}`)];
}

function formatFailedCase(caseResult: CaseResult): string[] {
  return [
    `- "${caseResult.prompt}" -> ${caseResult.actual} (expected: ${caseResult.expected})`,
    `  Reason: ${caseResult.rationale || "No rationale provided."}`,
  ];
}

function formatTranscriptStep(step: TranscriptStep): string {
  switch (step.kind) {
    case "model":
      return `- Model: ${step.text}`;
    case "tool-call":
      return `- Tool call ${step.tool}: ${formatValue(step.input)}`;
    case "tool-result":
      return `- Tool result ${step.tool}: ${formatValue(step.output)}`;
  }
}

function formatValue(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}
