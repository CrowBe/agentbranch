import type { ReactNode } from "react";
import type { RenderedDoc, SourceDoc, HeroView } from "@/modules/hero";
import type { SkillVersionLintSummary } from "@/modules/skill";
import { Button } from "./ui/button";
import { ViewToggle } from "./view-toggle";
import { ToolChips } from "./tool-chips";
import type {
  CapabilityPanel,
  EvaluationBreakdown,
  EvaluationFeedbackResult,
  InsightPanel,
  ToolAction,
  TranscriptStepPanel,
} from "./workspace";

/**
 * The hero — the centred streaming skill document, the product's centrepiece
 * (ARCHITECTURE §7). Two views over one artifact: Rendered (friendly doc,
 * default) and Source (raw SKILL.md). Flat surface, 1px border, radius-lg
 * (DESIGN §3.6, §5).
 */
export function HeroPanel({
  rendered,
  source,
  view,
  onViewChange,
  capability,
  activeTool,
  toolBusy,
  lintSummary,
  lintBusy,
  banner,
  onToolSelect,
  onLintSelect,
  onEvaluationSurfaceChange,
  onLintSurfaceChange,
  onSafetySurfaceChange,
  onReviseWithFeedback,
  feedbackBusy,
}: {
  rendered: RenderedDoc;
  source: SourceDoc;
  view: HeroView;
  onViewChange: (view: HeroView) => void;
  capability: CapabilityPanel | null;
  activeTool: ToolAction | null;
  toolBusy: boolean;
  lintSummary?: SkillVersionLintSummary | null;
  lintBusy: boolean;
  /** Draft state legibility + promote/discard controls (ARCHITECTURE §9.3). */
  banner?: ReactNode;
  onToolSelect: (action: ToolAction) => void;
  onLintSelect: () => void;
  onEvaluationSurfaceChange: (surface: "insights" | "breakdown") => void;
  onLintSurfaceChange: (surface: "insights" | "breakdown") => void;
  onSafetySurfaceChange: (surface: "insights" | "breakdown") => void;
  onReviseWithFeedback: (result: EvaluationFeedbackResult) => void;
  feedbackBusy: boolean;
}) {
  return (
    <section className="mx-auto flex h-full w-full max-w-3xl flex-col gap-4 px-6 py-8">
      {banner}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ToolChips active={activeTool} busy={toolBusy} onSelect={onToolSelect} />
        <ViewToggle value={view} onChange={onViewChange} />
      </div>

      <article className="flex-1 overflow-auto rounded-[var(--radius-lg)] border border-outline-variant bg-surface p-6">
        {capability ? (
          <CapabilityView
            panel={capability}
            busy={toolBusy}
            onEvaluationSurfaceChange={onEvaluationSurfaceChange}
            onLintSurfaceChange={onLintSurfaceChange}
            onSafetySurfaceChange={onSafetySurfaceChange}
            onReviseWithFeedback={onReviseWithFeedback}
            feedbackBusy={feedbackBusy}
          />
        ) : view === "rendered" ? (
          <RenderedView
            doc={rendered}
            lintSummary={lintSummary}
            lintBusy={lintBusy}
            onLintSelect={onLintSelect}
          />
        ) : (
          <SourceView doc={source} />
        )}
      </article>
    </section>
  );
}

function RenderedView({
  doc,
  lintSummary,
  lintBusy,
  onLintSelect,
}: {
  doc: RenderedDoc;
  lintSummary?: SkillVersionLintSummary | null;
  lintBusy: boolean;
  onLintSelect: () => void;
}) {
  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h1 className="text-display-lg">{doc.title}</h1>
          {lintSummary && (
            <button
              type="button"
              aria-label={`Quality ${lintSummary.grade} ${lintSummary.score}/100`}
              onClick={onLintSelect}
              disabled={lintBusy}
              className={`text-label inline-flex items-center gap-2 rounded-full px-3 py-1.5 transition-opacity hover:opacity-80 disabled:cursor-wait disabled:opacity-60 ${lintTone(lintSummary)}`}
            >
              <span>Quality {lintSummary.grade}</span>
              <span>{lintSummary.score}/100</span>
            </button>
          )}
        </div>
        <p className="text-doc-rendered text-on-surface-variant">{doc.description}</p>
      </header>
      {doc.sections.map((section, i) => (
        <section key={i} className="flex flex-col gap-1.5">
          {section.heading && <h2 className="text-doc-rendered-h">{section.heading}</h2>}
          <p className="text-doc-rendered whitespace-pre-wrap">{section.body}</p>
        </section>
      ))}
    </div>
  );
}

function SourceView({ doc }: { doc: SourceDoc }) {
  return (
    <pre className="text-doc-source overflow-auto whitespace-pre-wrap">
      <code>{doc.markdown}</code>
    </pre>
  );
}

function CapabilityView({
  panel,
  busy,
  onEvaluationSurfaceChange,
  onLintSurfaceChange,
  onSafetySurfaceChange,
  onReviseWithFeedback,
  feedbackBusy,
}: {
  panel: CapabilityPanel;
  busy: boolean;
  onEvaluationSurfaceChange: (surface: "insights" | "breakdown") => void;
  onLintSurfaceChange: (surface: "insights" | "breakdown") => void;
  onSafetySurfaceChange: (surface: "insights" | "breakdown") => void;
  onReviseWithFeedback: (result: EvaluationFeedbackResult) => void;
  feedbackBusy: boolean;
}) {
  if (panel.kind === "visualise") {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="text-headline-md">Visualise</h1>
        <pre className="text-doc-source overflow-auto whitespace-pre-wrap rounded-[var(--radius-sm)] border border-outline-variant bg-surface-high p-4">
          <code>{panel.mermaid}</code>
        </pre>
      </div>
    );
  }

  if (panel.kind === "export") {
    return (
      <div className="flex flex-col gap-4">
        <header className="flex flex-col gap-1">
          <h1 className="text-headline-md">Export</h1>
          <p className="text-doc-rendered text-on-surface-variant">{panel.rootDir}</p>
        </header>
        <div className="flex flex-col gap-3">
          {panel.files.map((file) => (
            <section key={file.path} className="rounded-[var(--radius-sm)] border border-outline-variant">
              <h2 className="text-label border-b border-outline-variant px-3 py-2 text-on-surface-variant">
                {file.path}
              </h2>
              <pre className="text-doc-source overflow-auto whitespace-pre-wrap p-3">
                <code>{file.contents}</code>
              </pre>
            </section>
          ))}
        </div>
      </div>
    );
  }

  if (panel.kind === "evaluation-progress") {
    return <EvaluationProgressView panel={panel} />;
  }

  if (panel.kind === "breakdown") {
    return (
      <div className="flex flex-col gap-4">
        <EvaluationSurfaceTabs
          value="breakdown"
          busy={busy}
          onChange={onEvaluationSurfaceChange}
        />
        {panel.breakdown.kind === "test-run" ? (
          <TestRunBreakdownView breakdown={panel.breakdown} />
        ) : (
          <TriggeringBreakdownView breakdown={panel.breakdown} />
        )}
      </div>
    );
  }

  if (panel.kind === "lint-breakdown") {
    return (
      <div className="flex flex-col gap-4">
        <EvaluationSurfaceTabs value="breakdown" busy={busy} onChange={onLintSurfaceChange} />
        <header className="flex flex-col gap-1">
          <p className="text-label text-on-surface-variant">{panel.title}</p>
          <h1 className="text-headline-md">
            Grade {panel.breakdown.summary.grade} · {panel.breakdown.summary.score}/100
          </h1>
        </header>
        <div className="flex flex-col gap-3">
          {panel.breakdown.findings.length === 0 ? (
            <p className="text-doc-rendered text-on-surface-variant">No deterministic lint findings.</p>
          ) : (
            panel.breakdown.findings.map((finding) => (
              <section key={`${finding.rule}-${finding.message}`} className="rounded-[var(--radius-sm)] border border-outline-variant p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-doc-rendered-h">{finding.rule}</h2>
                  <p className="text-label text-on-surface-variant">{finding.severity}</p>
                </div>
                <p className="text-doc-rendered mt-2 text-on-surface-variant">{finding.message}</p>
              </section>
            ))
          )}
        </div>
      </div>
    );
  }

  if (panel.kind === "safety-insights") {
    return (
      <div className="flex flex-col gap-4">
        <EvaluationSurfaceTabs value="insights" busy={busy} onChange={onSafetySurfaceChange} />
        <header className="flex flex-col gap-2">
          <p className="text-label text-on-surface-variant">{panel.title}</p>
          <h1 className="text-headline-md">{safetyVerdictLabel(panel.rating.verdict)}</h1>
          <p className="text-doc-rendered text-on-surface-variant">{panel.rating.insight.summary}</p>
        </header>
        <InsightList title="Findings" items={panel.rating.insight.findings} />
        <InsightList title="Watch" items={panel.rating.insight.watch} />
      </div>
    );
  }

  if (panel.kind === "safety-breakdown") {
    return (
      <div className="flex flex-col gap-4">
        <EvaluationSurfaceTabs value="breakdown" busy={busy} onChange={onSafetySurfaceChange} />
        <header className="flex flex-col gap-1">
          <p className="text-label text-on-surface-variant">{panel.title}</p>
          <h1 className="text-headline-md">{safetyVerdictLabel(panel.rating.verdict)}</h1>
        </header>
        <div className="flex flex-col gap-3">
          {panel.rating.scores.map((score) => (
            <section
              key={score.class}
              className="rounded-[var(--radius-sm)] border border-outline-variant p-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-doc-rendered-h capitalize">{score.class}</h2>
                <p className="text-label text-on-surface-variant">{score.score.toFixed(2)}</p>
              </div>
              <p className="text-doc-rendered mt-2 text-on-surface-variant">{score.rationale}</p>
            </section>
          ))}
        </div>
      </div>
    );
  }

  if (panel.kind === "lint-insights") {
    return (
      <div className="flex flex-col gap-4">
        <EvaluationSurfaceTabs value="insights" busy={busy} onChange={onLintSurfaceChange} />
        <header className="flex flex-col gap-2">
          <p className="text-label text-on-surface-variant">{panel.title}</p>
          <h1 className="text-headline-md">
            Grade {panel.insight.grade} · {panel.insight.score}/100
          </h1>
          <p className="text-doc-rendered text-on-surface-variant">{panel.insight.summary}</p>
        </header>
        <InsightList title="Findings" items={panel.insight.findings} />
        <InsightList title="Watch" items={panel.insight.watch} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <EvaluationSurfaceTabs value="insights" busy={busy} onChange={onEvaluationSurfaceChange} />
      <header className="flex flex-col gap-2">
        <p className="text-label text-on-surface-variant">{panel.title}</p>
        <h1 className="text-headline-md">{verdictLabel(panel.insight.verdict)}</h1>
        <p className="text-doc-rendered text-on-surface-variant">{panel.insight.summary}</p>
      </header>
      <InsightList title="Findings" items={panel.insight.findings} />
      <InsightList title="Watch" items={panel.insight.watch} />
      {panel.result && (
        <div>
          <Button
            type="button"
            variant="secondary"
            disabled={feedbackBusy}
            onClick={() => onReviseWithFeedback(panel.result!)}
          >
            Revise with this feedback
          </Button>
        </div>
      )}
    </div>
  );
}

function lintTone(summary: SkillVersionLintSummary): string {
  if (summary.counts.error > 0 || summary.grade === "D") return "bg-error/15 text-error";
  if (summary.counts.warn > 0 || summary.grade === "C") return "bg-tertiary/15 text-tertiary";
  return "bg-secondary/15 text-secondary";
}

function EvaluationProgressView({
  panel,
}: {
  panel: Extract<CapabilityPanel, { kind: "evaluation-progress" }>;
}) {
  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <p className="text-label text-on-surface-variant">{panel.title}</p>
        <h1 className="text-headline-md">Running</h1>
      </header>
      {panel.messages.length > 0 && (
        <div className="flex flex-col gap-2">
          {panel.messages.map((message, index) => (
            <p key={`${index}-${message}`} className="text-doc-rendered text-on-surface-variant">
              {message}
            </p>
          ))}
        </div>
      )}
      {panel.cases.length > 0 && (
        <div className="flex flex-col gap-3">
          {panel.cases.map((item) => (
            <section key={`${item.index}-${item.prompt}`} className="rounded-[var(--radius-sm)] border border-outline-variant p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-doc-rendered-h">{item.pass ? "Pass" : "Fail"}</h2>
                <p className="text-label text-on-surface-variant">
                  {item.index}/{item.total} · expected {item.expected} · got {item.actual}
                </p>
              </div>
              <p className="text-doc-rendered mt-2">{item.prompt}</p>
              <p className="text-doc-rendered mt-2 text-on-surface-variant">{item.rationale}</p>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function EvaluationSurfaceTabs({
  value,
  busy,
  onChange,
}: {
  value: "insights" | "breakdown";
  busy: boolean;
  onChange: (surface: "insights" | "breakdown") => void;
}) {
  return (
    <div className="inline-flex w-fit rounded-[var(--radius-sm)] border border-outline-variant p-1">
      {(["insights", "breakdown"] as const).map((surface) => (
        <button
          key={surface}
          type="button"
          disabled={busy || value === surface}
          onClick={() => onChange(surface)}
          className={`text-label rounded-[var(--radius-sm)] px-3 py-1.5 ${
            value === surface ? "bg-primary/15 text-primary" : "text-on-surface-variant"
          } disabled:cursor-not-allowed`}
        >
          {surface === "insights" ? "Insights" : "Breakdown"}
        </button>
      ))}
    </div>
  );
}

function TestRunBreakdownView({
  breakdown,
}: {
  breakdown: Extract<EvaluationBreakdown, { kind: "test-run" }>;
}) {
  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <p className="text-label text-on-surface-variant">Test run</p>
        <h1 className="text-headline-md">Breakdown</h1>
      </header>
      <section className="flex flex-col gap-2">
        <h2 className="text-doc-rendered-h">Scenario</h2>
        <p className="text-doc-rendered text-on-surface-variant">{breakdown.scenario.prompt}</p>
      </section>
      {breakdown.contractChecks && breakdown.contractChecks.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-doc-rendered-h">Tool contract checks</h2>
          <div className="flex flex-col gap-2">
            {breakdown.contractChecks.map((check) => (
              <div
                key={check.tool}
                className="rounded-[var(--radius-sm)] border border-outline-variant p-3"
              >
                <p className="text-doc-rendered">
                  <code>{check.tool}</code>{" "}
                  {check.called
                    ? `— called ${check.calls.length === 1 ? "once" : `${check.calls.length} times`}`
                    : "— never called"}
                </p>
                <ul className="text-doc-rendered mt-1 list-disc space-y-1 pl-5 text-on-surface-variant">
                  {check.calls.map((call) => {
                    const issues = [...call.argumentIssues, ...call.outputIssues];
                    return (
                      <li key={call.call}>
                        Call {call.call}:{" "}
                        {issues.length === 0 ? "arguments and output match the contract." : issues.join(" ")}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}
      <section className="flex flex-col gap-2">
        <h2 className="text-doc-rendered-h">Transcript</h2>
        <div className="flex flex-col gap-2">
          {breakdown.transcript.map((step, index) => (
            <pre
              key={index}
              className="text-doc-source overflow-auto whitespace-pre-wrap rounded-[var(--radius-sm)] border border-outline-variant bg-surface-high p-3"
            >
              <code>{formatTranscriptStep(step)}</code>
            </pre>
          ))}
        </div>
      </section>
    </div>
  );
}

function TriggeringBreakdownView({
  breakdown,
}: {
  breakdown: Extract<EvaluationBreakdown, { kind: "triggering-eval" }>;
}) {
  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <p className="text-label text-on-surface-variant">Triggering eval</p>
        <h1 className="text-headline-md">{breakdown.passed ? "Passed" : "Needs work"}</h1>
      </header>
      <div className="flex flex-col gap-3">
        {breakdown.cases.map((item) => (
          <section key={item.prompt} className="rounded-[var(--radius-sm)] border border-outline-variant p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-doc-rendered-h">{item.pass ? "Pass" : "Fail"}</h2>
              <p className="text-label text-on-surface-variant">
                expected {item.expected} · got {item.actual}
              </p>
            </div>
            <p className="text-doc-rendered mt-2">{item.prompt}</p>
            <p className="text-doc-rendered mt-2 text-on-surface-variant">{item.rationale}</p>
          </section>
        ))}
      </div>
    </div>
  );
}

function formatTranscriptStep(step: TranscriptStepPanel): string {
  if (step.kind === "model") return `model\n${step.text}`;
  if (step.kind === "tool-call") {
    return `tool-call ${step.tool}\n${JSON.stringify(step.input, null, 2)}`;
  }
  return `tool-result ${step.tool}\n${JSON.stringify(step.output, null, 2)}`;
}

function InsightList({ title, items }: { title: string; items: readonly string[] }) {
  if (items.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-doc-rendered-h">{title}</h2>
      <ul className="text-doc-rendered list-disc space-y-1 pl-5">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  );
}

function verdictLabel(verdict: InsightPanel["verdict"]): string {
  if (verdict === "good") return "Looks good";
  if (verdict === "needs-attention") return "Needs attention";
  return "Failing";
}

function safetyVerdictLabel(verdict: "passed" | "needs-review" | "blocked"): string {
  if (verdict === "passed") return "Passed";
  if (verdict === "needs-review") return "Needs review";
  return "Blocked";
}
