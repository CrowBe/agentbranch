import type { Artifact, SourceSpan } from "@/modules/skill-analysis";

export type LintSeverity = "error" | "warn" | "info";

export type LintFinding = {
  readonly rule: string;
  readonly severity: LintSeverity;
  readonly message: string;
  readonly sourceSpan?: SourceSpan;
};

export type LintSummary = {
  readonly score: number;
  readonly grade: "A" | "B" | "C" | "D";
  readonly counts: Readonly<Record<LintSeverity, number>>;
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
