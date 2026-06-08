import type { RenderedDoc, SourceDoc, HeroView } from "@/modules/hero";
import { ViewToggle } from "./view-toggle";
import { ToolChips, type ToolAction } from "./tool-chips";

export type CapabilityPanel =
  | { readonly kind: "visualise"; readonly mermaid: string }
  | { readonly kind: "insights"; readonly title: string; readonly insight: InsightPanel }
  | { readonly kind: "export"; readonly rootDir: string; readonly files: readonly ExportPanelFile[] };

export type InsightPanel = {
  readonly verdict: "good" | "needs-attention" | "failing";
  readonly summary: string;
  readonly findings: readonly string[];
  readonly watch: readonly string[];
};

export type ExportPanelFile = {
  readonly path: string;
  readonly contents: string;
};

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
  onToolSelect,
}: {
  rendered: RenderedDoc;
  source: SourceDoc;
  view: HeroView;
  onViewChange: (view: HeroView) => void;
  capability: CapabilityPanel | null;
  activeTool: ToolAction | null;
  toolBusy: boolean;
  onToolSelect: (action: ToolAction) => void;
}) {
  return (
    <section className="mx-auto flex h-full w-full max-w-3xl flex-col gap-4 px-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ToolChips active={activeTool} busy={toolBusy} onSelect={onToolSelect} />
        <ViewToggle value={view} onChange={onViewChange} />
      </div>

      <article className="flex-1 overflow-auto rounded-[var(--radius-lg)] border border-outline-variant bg-surface p-6">
        {capability ? (
          <CapabilityView panel={capability} />
        ) : view === "rendered" ? (
          <RenderedView doc={rendered} />
        ) : (
          <SourceView doc={source} />
        )}
      </article>
    </section>
  );
}

function RenderedView({ doc }: { doc: RenderedDoc }) {
  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-2">
        <h1 className="text-display-lg">{doc.title}</h1>
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

function CapabilityView({ panel }: { panel: CapabilityPanel }) {
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

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-2">
        <p className="text-label text-on-surface-variant">{panel.title}</p>
        <h1 className="text-headline-md">{verdictLabel(panel.insight.verdict)}</h1>
        <p className="text-doc-rendered text-on-surface-variant">{panel.insight.summary}</p>
      </header>
      <InsightList title="Findings" items={panel.insight.findings} />
      <InsightList title="Watch" items={panel.insight.watch} />
    </div>
  );
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
