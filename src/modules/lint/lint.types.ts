import type { Artifact, SourceSpan } from "@/modules/skill-analysis";

export type LintSeverity = "error" | "warn" | "info";

export type LintFinding = {
  readonly rule: string;
  readonly severity: LintSeverity;
  /** Optional rule-specific score cost; severity still drives counts and copy. */
  readonly scorePenalty?: number;
  readonly message: string;
  readonly sourceSpan?: SourceSpan;
};

export type LintSummary = {
  readonly score: number;
  readonly grade: "A" | "B" | "C" | "D";
  readonly counts: Readonly<Record<LintSeverity, number>>;
  /** Which rules fired, sorted unique — the static skill feature the harness
   * improvement loop correlates against evaluation outcomes (ARCHITECTURE §9). */
  readonly rules: readonly string[];
};

export type LintReport = Artifact<"lint"> & {
  readonly summary: LintSummary;
  readonly findings: readonly LintFinding[];
};

export type LintInsights = {
  readonly score: number;
  readonly grade: LintSummary["grade"];
  readonly summary: string;
  readonly findings: readonly string[];
  readonly watch: readonly string[];
};

export type LintBreakdown = {
  readonly summary: LintSummary;
  readonly findings: readonly LintFinding[];
};
