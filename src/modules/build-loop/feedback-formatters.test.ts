import { describe, expect, it } from "vitest";
import type { TestRunResult } from "@/modules/test-run";
import type { TriggeringResult } from "@/modules/triggering-eval";
import type { LintReport } from "@/modules/lint";
import {
  formatLintFeedback,
  formatTestRunFeedback,
  formatTriggeringEvalFeedback,
} from "./feedback-formatters";

describe("eval feedback formatters", () => {
  it("formats failed triggering eval cases with rationale", () => {
    const result: TriggeringResult = {
      kind: "triggering-eval",
      passed: false,
      insight: {
        verdict: "failing",
        summary: "The skill fires on unrelated email prompts.",
        findings: ["fires on calendar scheduling"],
        watch: ["also fires on email drafting"],
      },
      cases: [
        {
          prompt: "Schedule a meeting for tomorrow.",
          expected: "fire",
          actual: "fire",
          pass: true,
          rationale: "Calendar scheduling matches.",
        },
        {
          prompt: "Draft a customer follow-up email.",
          expected: "silent",
          actual: "fire",
          pass: false,
          rationale: "The description mentions customer follow-up work.",
        },
      ],
    };

    expect(formatTriggeringEvalFeedback(result)).toMatchInlineSnapshot(`
      "Triggering eval - failing

      The skill fires on unrelated email prompts.

      What's working:
      - fires on calendar scheduling

      Watch:
      - also fires on email drafting

      Failed cases:
      - "Draft a customer follow-up email." -> fire (expected: silent)
        Reason: The description mentions customer follow-up work.

      Please revise the skill to address these triggering failures. The description and trigger surface are the primary targets."
    `);
  });

  it("states that no revision is needed when every triggering eval case passes", () => {
    const result: TriggeringResult = {
      kind: "triggering-eval",
      passed: true,
      insight: {
        verdict: "good",
        summary: "The trigger surface is precise.",
        findings: [],
        watch: [],
      },
      cases: [
        {
          prompt: "Schedule a meeting for tomorrow.",
          expected: "fire",
          actual: "fire",
          pass: true,
          rationale: "Calendar scheduling matches.",
        },
      ],
    };

    expect(formatTriggeringEvalFeedback(result)).toContain("All triggering eval cases passed.");
    expect(formatTriggeringEvalFeedback(result)).toContain("No revision is needed");
    expect(formatTriggeringEvalFeedback(result)).toContain("- None.");
  });

  it("formats test-run scenario, insight, and transcript", () => {
    const result: TestRunResult = {
      kind: "test-run",
      scenario: {
        prompt: "Summarise the recent customer tickets.",
        seedData: { customer: "Acme" },
      },
      insight: {
        verdict: "needs-attention",
        summary: "The skill found tickets but skipped prioritisation.",
        findings: ["called the ticket search tool"],
        watch: [],
      },
      transcript: [
        { kind: "model", text: "I will inspect the tickets." },
        { kind: "tool-call", tool: "search_tickets", input: { customer: "Acme" } },
        { kind: "tool-result", tool: "search_tickets", output: { tickets: ["T-100"] } },
      ],
    };

    expect(formatTestRunFeedback(result)).toMatchInlineSnapshot(`
      "Test run - needs-attention

      Scenario: Summarise the recent customer tickets.

      The skill found tickets but skipped prioritisation.

      What's working:
      - called the ticket search tool

      Watch:
      - None.

      Transcript:
      - Model: I will inspect the tickets.
      - Tool call search_tickets: {"customer":"Acme"}
      - Tool result search_tickets: {"tickets":["T-100"]}

      Please revise the skill to address this test-run evidence. The body workflow and instructions are the primary targets."
    `);
  });

  it("formats lint findings by severity", () => {
    const report: LintReport = {
      kind: "lint",
      summary: { score: 55, grade: "D", counts: { error: 1, warn: 1, info: 0 } },
      findings: [
        {
          rule: "frontmatter.description.required",
          severity: "error",
          message: "Your skill needs a frontmatter `description` so agents know when to use it.",
        },
        {
          rule: "body.examples.missing",
          severity: "warn",
          message: "Add an example so the intended behaviour is concrete.",
        },
      ],
    };

    expect(formatLintFeedback(report)).toMatchInlineSnapshot(`
      "Lint - Quality D 55/100

      The deterministic lint pass found issues in the current SKILL.md.

      Errors:
      - Your skill needs a frontmatter \`description\` so agents know when to use it.

      Warnings:
      - Add an example so the intended behaviour is concrete.

      Info:
      - None.

      Please revise the skill to address these lint findings. Fix errors first, then tighten warnings."
    `);
  });

  it("skips lint feedback for clean reports", () => {
    const report: LintReport = {
      kind: "lint",
      summary: { score: 100, grade: "A", counts: { error: 0, warn: 0, info: 0 } },
      findings: [],
    };

    expect(formatLintFeedback(report)).toBeNull();
  });
});
