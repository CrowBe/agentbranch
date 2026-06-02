import type { RenderedDoc, SourceDoc, HeroView } from "@/modules/hero";
import { ViewToggle } from "./view-toggle";
import { ToolChips } from "./tool-chips";

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
}: {
  rendered: RenderedDoc;
  source: SourceDoc;
  view: HeroView;
  onViewChange: (view: HeroView) => void;
}) {
  return (
    <section className="mx-auto flex h-full w-full max-w-3xl flex-col gap-4 px-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ToolChips />
        <ViewToggle value={view} onChange={onViewChange} />
      </div>

      <article className="flex-1 overflow-auto rounded-[var(--radius-lg)] border border-outline-variant bg-surface p-6">
        {view === "rendered" ? (
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
