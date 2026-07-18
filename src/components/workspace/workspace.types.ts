import type { RenderedDoc, SourceDoc, HeroView } from "@/modules/hero";
import type { SafetyReviewScore, SafetyReviewVerdict } from "@/modules/safety-review";
import type { SkillSource, SkillVersionLintSummary } from "@/modules/skill";
import type { TestRunResult } from "@/modules/test-run";
import type { TriggeringResult } from "@/modules/triggering-eval";
import type { LocalSuggestionProvider } from "./local-suggestion-provider";

/**
 * The client workspace's interface: one state snapshot + the actions that move
 * it (ARCHITECTURE §7, issue #159). The workspace owns the HTTP protocol and
 * the request choreography; the app shell is a renderer wired to this surface.
 * Everything here is plain data — no React.
 */

export type InteractionMode = "build" | "import" | "skills" | "equipment" | "history" | "templates";

/** The tool surfaces reachable from the hero's chips. */
export type ToolAction =
  | "metadata"
  | "visualise"
  | "test-run"
  | "triggering-eval"
  | "safety-review"
  | "export";

export type EvaluationToolAction = "test-run" | "triggering-eval";
export type EvaluationFeedbackResult = TestRunResult | TriggeringResult;

/** One line (or actionable card) in the interaction panel's drawer. */
export type InteractionEntry = {
  readonly id: string;
  readonly label: string;
  readonly tone?: "muted" | "error";
  readonly actionLabel?: string;
  readonly onAction?: () => void;
};

/** A draft in progress, summarised for the resume affordance (ARCHITECTURE §9.3). */
export type DraftSummary = {
  readonly id: string;
  readonly revision: number | null;
  readonly name: string | null;
  readonly description: string | null;
};

/** One checked equipment document kept for the session (raw JSON text). */
type EquipmentDoc = { readonly name: string; readonly raw: string };

export type EquipmentState = {
  readonly contracts: readonly EquipmentDoc[];
  readonly schemas: readonly EquipmentDoc[];
};

export type EquipmentKind = "tool-contract" | "response-schema";

export type SkillLibraryEntryPanel = {
  readonly name: string;
  readonly owner: string;
  readonly slug: string;
  readonly tier: "published" | "reviewed";
  readonly trustLabel: string;
  readonly safety: {
    readonly status: "safety-badge" | "potentially-unsafe";
    readonly label: string;
    readonly ratingId: string | null;
  };
  readonly contentHash: string;
  readonly description: string | null;
  readonly category: string | null;
  readonly tags: readonly string[];
  readonly source: {
    readonly type: "git";
    readonly ref: "HEAD";
    readonly path: string;
  };
};

/**
 * The safety rating held for the version on the hero (ARCHITECTURE §9.1).
 * Null means the version is unrated — the manual "Safety" scan is on offer.
 * The full rating rides in one shape so Insights and the breakdown render
 * locally; switching surfaces never re-spends credits.
 */
export type SafetyRatingState = {
  readonly verdict: SafetyReviewVerdict;
  readonly scores: readonly SafetyReviewScore[];
  readonly insight: InsightPanel;
};

export type CapabilityPanel =
  | {
      readonly kind: "metadata-suggestion";
      readonly name: string;
      readonly description: string;
      readonly category: string | null;
      readonly tags: readonly string[];
      readonly rationale: string;
      readonly provenance: "on-device" | "route";
    }
  | { readonly kind: "visualise"; readonly mermaid: string }
  | {
      readonly kind: "evaluation-progress";
      readonly action: EvaluationToolAction;
      readonly title: string;
      readonly messages: readonly string[];
      readonly cases: readonly TriggeringCaseProgressPanel[];
    }
  | {
      readonly kind: "insights";
      readonly action: EvaluationToolAction;
      readonly title: string;
      readonly insight: InsightPanel;
      readonly result?: EvaluationFeedbackResult;
    }
  | {
      readonly kind: "breakdown";
      readonly action: EvaluationToolAction;
      readonly title: string;
      readonly breakdown: EvaluationBreakdown;
    }
  | {
      readonly kind: "lint-insights";
      readonly title: string;
      readonly insight: LintInsightPanel;
    }
  | {
      readonly kind: "lint-breakdown";
      readonly title: string;
      readonly breakdown: LintBreakdownPanel;
    }
  | {
      readonly kind: "safety-insights";
      readonly title: string;
      readonly rating: SafetyRatingState;
    }
  | {
      readonly kind: "safety-breakdown";
      readonly title: string;
      readonly rating: SafetyRatingState;
    }
  | { readonly kind: "export"; readonly rootDir: string; readonly files: readonly ExportPanelFile[] };

export type InsightPanel = {
  readonly verdict: "good" | "needs-attention" | "failing";
  readonly summary: string;
  readonly findings: readonly string[];
  readonly watch: readonly string[];
};

export type LintInsightPanel = {
  readonly score: number;
  readonly grade: SkillVersionLintSummary["grade"];
  readonly summary: string;
  readonly findings: readonly string[];
  readonly watch: readonly string[];
};

export type LintBreakdownPanel = {
  readonly summary: SkillVersionLintSummary;
  readonly findings: readonly {
    readonly rule: string;
    readonly severity: "error" | "warn" | "info";
    readonly message: string;
  }[];
};

export type EvaluationBreakdown =
  | {
      readonly kind: "test-run";
      readonly scenario: { readonly prompt: string };
      readonly transcript: readonly TranscriptStepPanel[];
      /** Per-contract validation when the run had tool contracts attached. */
      readonly contractChecks?: readonly ContractCheckPanel[];
    }
  | {
      readonly kind: "triggering-eval";
      readonly passed: boolean;
      readonly cases: readonly TriggeringCasePanel[];
    };

export type ContractCheckPanel = {
  readonly tool: string;
  readonly called: boolean;
  readonly calls: readonly {
    readonly call: number;
    readonly argumentIssues: readonly string[];
    readonly outputIssues: readonly string[];
  }[];
};

export type TranscriptStepPanel =
  | { readonly kind: "model"; readonly text: string }
  | { readonly kind: "tool-call"; readonly tool: string; readonly input: unknown }
  | { readonly kind: "tool-result"; readonly tool: string; readonly output: unknown };

type TriggeringCasePanel = {
  readonly prompt: string;
  readonly expected: "fire" | "silent";
  readonly actual: "fire" | "silent";
  readonly pass: boolean;
  readonly rationale: string;
};

export type TriggeringCaseProgressPanel = TriggeringCasePanel & {
  readonly index: number;
  readonly total: number;
};

type ExportPanelFile = {
  readonly path: string;
  readonly contents: string;
};

export type HeroDocs = { readonly rendered: RenderedDoc; readonly source: SourceDoc };

/** The one immutable snapshot the app shell renders from. */
export type WorkspaceSnapshot = {
  readonly status: string | null;
  readonly heroDocs: HeroDocs;
  readonly view: HeroView;
  readonly mode: InteractionMode;
  readonly current: SkillSource | null;
  readonly currentSkillId: string | null;
  readonly lintSummary: SkillVersionLintSummary | null;
  readonly entries: readonly InteractionEntry[];
  readonly capability: CapabilityPanel | null;
  readonly activeTool: ToolAction | null;
  readonly equipment: EquipmentState;
  /** The stored safety rating for the version on the hero; null = unrated. */
  readonly safetyRating: SafetyRatingState | null;
  /** Non-null means the hero is showing an in-progress draft (ARCHITECTURE §9.3). */
  readonly branchId: string | null;
  readonly openDrafts: readonly DraftSummary[];
  readonly busy: boolean;
  readonly toolBusy: boolean;
  readonly lintBusy: boolean;
  readonly draftBusy: boolean;
  readonly equipmentBusy: boolean;
};

export type EvaluationSurface = "insights" | "breakdown";

export type WorkspaceActions = {
  readonly setView: (view: HeroView) => void;
  readonly showBuild: () => void;
  readonly showImport: () => void;
  readonly showSkills: () => Promise<void>;
  readonly showEquipment: () => void;
  readonly showHistory: () => Promise<void>;
  readonly showTemplates: (query?: string) => Promise<void>;
  readonly send: (message: string) => Promise<void>;
  readonly importSkill: (raw: string) => Promise<void>;
  readonly submitEquipment: (raw: string) => Promise<void>;
  readonly openSkill: (id: string) => Promise<void>;
  readonly restoreVersion: (id: string, revision: number) => Promise<void>;
  readonly startDraft: () => Promise<void>;
  readonly openDraft: (id: string) => Promise<void>;
  readonly promote: () => Promise<void>;
  readonly discardDraft: () => Promise<void>;
  readonly publish: (owner: string, name: string) => Promise<void>;
  readonly runTool: (action: ToolAction) => Promise<void>;
  readonly selectEvaluationSurface: (surface: EvaluationSurface) => Promise<void>;
  readonly selectLintSurface: (surface: EvaluationSurface) => Promise<void>;
  /** Re-render the stored rating on the other surface — local, zero spend. */
  readonly selectSafetySurface: (surface: EvaluationSurface) => void;
  readonly reviseWithFeedback: (result: EvaluationFeedbackResult) => void;
  readonly applyMetadataSuggestion: () => void;
};

export type Workspace = {
  readonly getSnapshot: () => WorkspaceSnapshot;
  readonly subscribe: (listener: () => void) => () => void;
  readonly actions: WorkspaceActions;
};

export type WorkspaceInit = {
  readonly rendered: RenderedDoc;
  readonly source: SourceDoc;
  readonly initialSkill: SkillSource;
  readonly initialLintSummary?: SkillVersionLintSummary | null;
};

/** Injectable edges so choreography is testable without a browser. */
export type WorkspaceDeps = {
  readonly fetch?: typeof globalThis.fetch;
  readonly confirm?: (message: string) => boolean;
  readonly localSuggestionProvider?: LocalSuggestionProvider;
};
