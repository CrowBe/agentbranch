import type { TestRunResult, TranscriptStep } from "@/modules/test-run";
import type { CaseResult, TriggeringResult } from "@/modules/triggering-eval";

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
    "Transcript:",
    ...result.transcript.map(formatTranscriptStep),
    "",
    "Please revise the skill to address this test-run evidence. The body workflow and instructions are the primary targets.",
  ].join("\n");
}

function formatList(label: string, items: readonly string[]): string[] {
  if (items.length === 0) return [label, "- None."];
  return [label, ...items.map((item) => `- ${item}`)];
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
