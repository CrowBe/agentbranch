import type { RenderedDoc, SourceDoc } from "@/modules/hero";
import type { SkillSource, SkillVersionLintSummary } from "@/modules/skill";
import type { TestRunResult } from "@/modules/test-run";
import type { TriggeringResult } from "@/modules/triggering-eval";
import type {
  CapabilityPanel,
  ContractCheckPanel,
  DraftSummary,
  EvaluationBreakdown,
  EvaluationFeedbackResult,
  EvaluationSurface,
  EvaluationToolAction,
  LintBreakdownPanel,
  LintInsightPanel,
  InsightPanel,
  ToolAction,
} from "./workspace.types";

/**
 * One typed decoder per route — the single place the client re-checks a server
 * response's shape, against the domain modules' exported types (issue #159).
 * Shape drift between a route and this file breaks *here*, loudly, not in
 * scattered guards. Decoders throw on an unexpected shape; the workspace's
 * choreography catches and surfaces the message.
 */

// ---------------------------------------------------------------------------
// Error bodies (shared by every route)

export function friendlyError(message: string): string {
  if (message.includes("cap_reached")) return "Out of free usage today.";
  if (message.includes("model_unavailable")) return "No model is configured.";
  return message;
}

export function errorMessage(body: unknown, status: number): string {
  const error = body && typeof body === "object" && "error" in body ? String(body.error) : "";
  return friendlyError(error || `Request failed (${status}).`);
}

export function importErrorMessage(body: unknown, status: number): string {
  const error = body && typeof body === "object" && "error" in body ? String(body.error) : "";
  return friendlyError(error || `Import failed (${status}).`);
}

export function toolErrorMessage(body: unknown, status: number, action: ToolAction): string {
  const error = body && typeof body === "object" && "error" in body ? String(body.error) : "";
  const code = body && typeof body === "object" && "code" in body ? String(body.code) : "";
  if (code === "cap_reached" && action === "triggering-eval") {
    return "Triggering eval is not available on the free plan.";
  }
  if (code === "cap_reached") return "Out of free usage today.";
  if (code === "model_unavailable" || code === "not_configured") return "No model is configured.";
  return friendlyError(error || `Request failed (${status}).`);
}

// ---------------------------------------------------------------------------
// POST /api/import

export type ImportResponse = {
  readonly skill: {
    readonly id: string;
    readonly source: SkillSource;
    readonly lintSummary?: SkillVersionLintSummary | null;
  };
  readonly rendered: RenderedDoc;
  readonly source: SourceDoc;
};

export function decodeImportResponse(body: unknown): ImportResponse {
  if (
    !isRecord(body) ||
    !isRecord(body.skill) ||
    typeof body.skill.id !== "string" ||
    !isSkillSource(body.skill.source) ||
    ("lintSummary" in body.skill &&
      body.skill.lintSummary !== null &&
      !isLintSummary(body.skill.lintSummary)) ||
    !isRenderedDoc(body.rendered) ||
    !isSourceDoc(body.source)
  ) {
    throw new Error("Import returned an unexpected response.");
  }
  return {
    skill: {
      id: body.skill.id,
      source: body.skill.source,
      lintSummary: isLintSummary(body.skill.lintSummary) ? body.skill.lintSummary : null,
    },
    rendered: body.rendered,
    source: body.source,
  };
}

// ---------------------------------------------------------------------------
// GET /api/skills

export type SkillListItem = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
};

export function decodeSkillList(body: unknown): readonly SkillListItem[] {
  if (!isRecord(body) || !Array.isArray(body.skills)) {
    throw new Error("Skills returned an unexpected response.");
  }
  return body.skills.map((skill) => {
    if (
      !isRecord(skill) ||
      typeof skill.id !== "string" ||
      typeof skill.name !== "string" ||
      typeof skill.description !== "string"
    ) {
      throw new Error("Skills returned an unexpected response.");
    }
    return { id: skill.id, name: skill.name, description: skill.description };
  });
}

// ---------------------------------------------------------------------------
// GET /api/skills/[id] · POST /api/skills/[id]/restore

export type SkillDetail = {
  readonly skill: {
    readonly id: string;
    readonly source: SkillSource;
    readonly latestRevision: number;
    readonly lintSummary?: SkillVersionLintSummary | null;
  };
  readonly versions: readonly {
    readonly id: string;
    readonly revision: number;
    readonly source: SkillSource;
    readonly lintSummary?: SkillVersionLintSummary | null;
  }[];
};

export function decodeSkillDetail(body: unknown): SkillDetail {
  if (
    !isRecord(body) ||
    !isRecord(body.skill) ||
    typeof body.skill.id !== "string" ||
    !isSkillSource(body.skill.source) ||
    typeof body.skill.latestRevision !== "number"
  ) {
    throw new Error("Skill returned an unexpected response.");
  }
  const versions = Array.isArray(body.versions)
    ? body.versions.map((version) => {
        if (
          !isRecord(version) ||
          typeof version.id !== "string" ||
          typeof version.revision !== "number" ||
          !isSkillSource(version.source) ||
          ("lintSummary" in version &&
            version.lintSummary !== null &&
            !isLintSummary(version.lintSummary))
        ) {
          throw new Error("Skill returned an unexpected response.");
        }
        const lintSummary =
          "lintSummary" in version && isLintSummary(version.lintSummary)
            ? version.lintSummary
            : null;
        return {
          id: version.id,
          revision: version.revision,
          source: version.source,
          lintSummary,
        };
      })
    : [];
  return {
    skill: {
      id: body.skill.id,
      source: body.skill.source,
      latestRevision: body.skill.latestRevision,
      lintSummary:
        "lintSummary" in body.skill && isLintSummary(body.skill.lintSummary)
          ? body.skill.lintSummary
          : null,
    },
    versions,
  };
}

export function latestLintSummary(detail: SkillDetail): SkillVersionLintSummary | null {
  return (
    detail.versions.find((version) => version.revision === detail.skill.latestRevision)
      ?.lintSummary ?? null
  );
}

// ---------------------------------------------------------------------------
// GET /api/skills/[id]/runs

export type RunHistory = {
  readonly testRuns: readonly { readonly status: string; readonly prompt: string }[];
  readonly evalRuns: readonly { readonly status: string; readonly summary: string }[];
};

export function decodeRunHistory(body: unknown): RunHistory {
  if (!isRecord(body) || !Array.isArray(body.testRuns) || !Array.isArray(body.evalRuns)) {
    throw new Error("History returned an unexpected response.");
  }
  return {
    testRuns: body.testRuns.map((run) => {
      if (!isRecord(run) || typeof run.status !== "string" || !isRecord(run.scenario)) {
        throw new Error("History returned an unexpected response.");
      }
      return {
        status: run.status,
        prompt: typeof run.scenario.prompt === "string" ? run.scenario.prompt : "Untitled scenario",
      };
    }),
    evalRuns: body.evalRuns.map((run) => {
      if (!isRecord(run) || typeof run.status !== "string" || !isRecord(run.result)) {
        throw new Error("History returned an unexpected response.");
      }
      const result = run.result;
      const summary =
        isRecord(result.insight) && typeof result.insight.summary === "string"
          ? result.insight.summary
          : "No summary stored.";
      return { status: run.status, summary };
    }),
  };
}

// ---------------------------------------------------------------------------
// GET /api/skills/[id]/branches

export function decodeDraftList(body: unknown): DraftSummary[] {
  if (!isRecord(body) || !Array.isArray(body.branches)) return [];
  return body.branches
    .filter(
      (branch): branch is Record<string, unknown> =>
        isRecord(branch) && branch.isMain === false && branch.status === "open",
    )
    .map((branch) => ({
      id: String(branch.id),
      revision: typeof branch.revision === "number" ? branch.revision : null,
      name: typeof branch.name === "string" ? branch.name : null,
      description: typeof branch.description === "string" ? branch.description : null,
    }));
}

// ---------------------------------------------------------------------------
// POST /api/skills/[id]/branches · GET /api/skills/[id]/branches/[branchId]

export type BranchDetail = {
  readonly id: string;
  readonly source: SkillSource;
  readonly lintSummary: SkillVersionLintSummary | null;
};

export function decodeBranchDetail(body: unknown): BranchDetail {
  if (!isRecord(body) || !isRecord(body.branch)) {
    throw new Error("Draft returned an unexpected response.");
  }
  const branch = body.branch;
  if (typeof branch.id !== "string" || !isSkillSource(branch.source)) {
    throw new Error("Draft returned an unexpected response.");
  }
  return {
    id: branch.id,
    source: branch.source,
    lintSummary: isLintSummary(branch.lintSummary) ? branch.lintSummary : null,
  };
}

// ---------------------------------------------------------------------------
// POST /api/skills/[id]/branches/[branchId]/promote

export type PromotedSkill = {
  readonly source: SkillSource;
  readonly lintSummary: SkillVersionLintSummary | null;
};

export function decodePromotedSkill(body: unknown): PromotedSkill {
  if (!isRecord(body) || !isRecord(body.skill) || !isSkillSource(body.skill.source)) {
    throw new Error("Setting the main version returned an unexpected response.");
  }
  return {
    source: body.skill.source,
    lintSummary: isLintSummary(body.skill.lintSummary) ? body.skill.lintSummary : null,
  };
}

// ---------------------------------------------------------------------------
// POST /api/lint

export function decodeLintPanel(surface: EvaluationSurface, body: unknown): CapabilityPanel {
  if (surface === "breakdown" && isLintBreakdown(body)) {
    return { kind: "lint-breakdown", title: "Quality", breakdown: body };
  }
  if (surface === "insights" && isLintInsight(body)) {
    return { kind: "lint-insights", title: "Quality", insight: body };
  }
  throw new Error("Quality returned an unexpected response.");
}

/** The breakdown surface carries the deterministic summary worth pinning to the hero chip. */
export function lintSummaryFromPanel(panel: CapabilityPanel): SkillVersionLintSummary | null {
  return panel.kind === "lint-breakdown" ? panel.breakdown.summary : null;
}

// ---------------------------------------------------------------------------
// POST /api/tool-contract · POST /api/response-schema (equipment checks)

export function decodeEquipmentInsight(body: unknown): LintInsightPanel {
  if (!isLintInsight(body)) {
    throw new Error("Equipment check returned an unexpected response.");
  }
  return body;
}

// ---------------------------------------------------------------------------
// POST /api/visualise · /api/export · /api/test-run · /api/triggering-eval

export function decodeCapabilityPanel(
  action: ToolAction,
  surface: EvaluationSurface,
  body: unknown,
  title: string,
  result?: unknown,
): CapabilityPanel {
  if (action === "visualise" && isRecord(body) && typeof body.mermaid === "string") {
    return { kind: "visualise", mermaid: body.mermaid };
  }

  if (action === "export" && isRecord(body)) {
    const files = Array.isArray(body.files) ? body.files.filter(isExportFile) : [];
    return {
      kind: "export",
      rootDir: typeof body.rootDir === "string" ? body.rootDir : "skill",
      files,
    };
  }

  if (isEvaluationTool(action) && surface === "breakdown") {
    const breakdown = toEvaluationBreakdown(action, body);
    if (breakdown) {
      return { kind: "breakdown", action, title, breakdown };
    }
  }

  if (isEvaluationTool(action) && isInsight(body)) {
    return {
      kind: "insights",
      action,
      title,
      insight: body,
      result: toEvaluationFeedbackResult(action, result),
    };
  }

  throw new Error("Capability returned an unexpected response.");
}

export function isEvaluationTool(action: ToolAction): action is EvaluationToolAction {
  return action === "test-run" || action === "triggering-eval";
}

function toEvaluationFeedbackResult(
  action: EvaluationToolAction,
  result: unknown,
): EvaluationFeedbackResult | undefined {
  if (action === "test-run" && isTestRunResult(result)) return result;
  if (action === "triggering-eval" && isTriggeringResult(result)) return result;
  return undefined;
}

function toEvaluationBreakdown(
  action: EvaluationToolAction,
  body: unknown,
): EvaluationBreakdown | null {
  if (action === "test-run" && isTestRunBreakdown(body)) {
    return {
      kind: "test-run",
      scenario: body.scenario,
      transcript: body.transcript,
      contractChecks:
        isRecord(body) && isContractChecks(body.contractChecks) ? body.contractChecks : undefined,
    };
  }
  if (action === "triggering-eval" && isTriggeringBreakdown(body)) {
    return { kind: "triggering-eval", passed: body.passed, cases: body.cases };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Shape guards shared by the decoders above (private — every route decodes here)

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function isExportFile(value: unknown): value is { readonly path: string; readonly contents: string } {
  return isRecord(value) && typeof value.path === "string" && typeof value.contents === "string";
}

function isSkillSource(value: unknown): value is SkillSource {
  return (
    isRecord(value) &&
    isRecord(value.frontmatter) &&
    typeof value.frontmatter.name === "string" &&
    typeof value.frontmatter.description === "string" &&
    isRecord(value.frontmatter.extra) &&
    typeof value.body === "string"
  );
}

function isLintSummary(value: unknown): value is SkillVersionLintSummary {
  return (
    isRecord(value) &&
    typeof value.score === "number" &&
    isLintGrade(value.grade) &&
    isRecord(value.counts) &&
    typeof value.counts.error === "number" &&
    typeof value.counts.warn === "number" &&
    typeof value.counts.info === "number"
  );
}

function isLintGrade(value: unknown): value is SkillVersionLintSummary["grade"] {
  return value === "A" || value === "B" || value === "C" || value === "D";
}

function isRenderedDoc(value: unknown): value is RenderedDoc {
  return (
    isRecord(value) &&
    typeof value.title === "string" &&
    typeof value.description === "string" &&
    Array.isArray(value.sections)
  );
}

function isSourceDoc(value: unknown): value is SourceDoc {
  return isRecord(value) && typeof value.markdown === "string";
}

function isInsight(value: unknown): value is InsightPanel {
  return (
    isRecord(value) &&
    (value.verdict === "good" ||
      value.verdict === "needs-attention" ||
      value.verdict === "failing") &&
    typeof value.summary === "string" &&
    Array.isArray(value.findings) &&
    value.findings.every((item) => typeof item === "string") &&
    Array.isArray(value.watch) &&
    value.watch.every((item) => typeof item === "string")
  );
}

function isLintInsight(value: unknown): value is LintInsightPanel {
  return (
    isRecord(value) &&
    typeof value.score === "number" &&
    isLintGrade(value.grade) &&
    typeof value.summary === "string" &&
    Array.isArray(value.findings) &&
    value.findings.every((item) => typeof item === "string") &&
    Array.isArray(value.watch) &&
    value.watch.every((item) => typeof item === "string")
  );
}

function isLintBreakdown(value: unknown): value is LintBreakdownPanel {
  return (
    isRecord(value) &&
    isLintSummary(value.summary) &&
    Array.isArray(value.findings) &&
    value.findings.every(isLintFinding)
  );
}

function isLintFinding(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.rule === "string" &&
    (value.severity === "error" || value.severity === "warn" || value.severity === "info") &&
    typeof value.message === "string"
  );
}

function isTestRunBreakdown(
  value: unknown,
): value is Extract<EvaluationBreakdown, { kind: "test-run" }> {
  return (
    isRecord(value) &&
    isRecord(value.scenario) &&
    typeof value.scenario.prompt === "string" &&
    Array.isArray(value.transcript) &&
    value.transcript.every(isTranscriptStep)
  );
}

function isTestRunResult(value: unknown): value is TestRunResult {
  return (
    isRecord(value) &&
    value.kind === "test-run" &&
    isRecord(value.scenario) &&
    typeof value.scenario.prompt === "string" &&
    isRecord(value.scenario.seedData) &&
    Array.isArray(value.transcript) &&
    value.transcript.every(isTranscriptStep) &&
    isContractChecks(value.contractChecks) &&
    isInsight(value.insight)
  );
}

function isContractChecks(value: unknown): value is ContractCheckPanel[] {
  return (
    Array.isArray(value) &&
    value.every(
      (check) =>
        isRecord(check) &&
        typeof check.tool === "string" &&
        typeof check.called === "boolean" &&
        Array.isArray(check.calls) &&
        check.calls.every(
          (call) =>
            isRecord(call) &&
            typeof call.call === "number" &&
            Array.isArray(call.argumentIssues) &&
            call.argumentIssues.every((issue) => typeof issue === "string") &&
            Array.isArray(call.outputIssues) &&
            call.outputIssues.every((issue) => typeof issue === "string"),
        ),
    )
  );
}

function isTranscriptStep(value: unknown): boolean {
  if (!isRecord(value) || typeof value.kind !== "string") return false;
  if (value.kind === "model") return typeof value.text === "string";
  if (value.kind === "tool-call") return typeof value.tool === "string" && "input" in value;
  if (value.kind === "tool-result") return typeof value.tool === "string" && "output" in value;
  return false;
}

function isTriggeringBreakdown(
  value: unknown,
): value is Extract<EvaluationBreakdown, { kind: "triggering-eval" }> {
  return (
    isRecord(value) &&
    typeof value.passed === "boolean" &&
    Array.isArray(value.cases) &&
    value.cases.every(isTriggeringCase)
  );
}

function isTriggeringResult(value: unknown): value is TriggeringResult {
  return (
    isRecord(value) &&
    value.kind === "triggering-eval" &&
    typeof value.passed === "boolean" &&
    Array.isArray(value.cases) &&
    value.cases.every(isTriggeringCase) &&
    isInsight(value.insight)
  );
}

function isTriggeringCase(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.prompt === "string" &&
    (value.expected === "fire" || value.expected === "silent") &&
    (value.actual === "fire" || value.actual === "silent") &&
    typeof value.pass === "boolean" &&
    typeof value.rationale === "string"
  );
}
