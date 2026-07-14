"use client";

import { useEffect, useState } from "react";

/**
 * Client-side Mermaid renderer for the Visualise capability. The visualise
 * module emits Mermaid *source* (its renderer stays pure text on the seam);
 * this component turns that source into an actual diagram in the hero, themed
 * from the DESIGN §4 tokens read off the live theme. While the (lazily
 * imported) library loads — and whenever rendering fails — the source shows as
 * a doc-source block, so the surface degrades to exactly the old behaviour.
 *
 * Mermaid runs with `securityLevel: "strict"` and the SVG is produced locally
 * from our own IR→Mermaid serializer (labels escaped there); the skill text
 * never reaches the DOM unsanitised.
 */
export function MermaidDiagram({ source }: { source: string }) {
  // The svg is keyed to the source it was rendered from, so a source change
  // falls back to the code block until the new diagram lands — no reset write.
  const [diagram, setDiagram] = useState<{ source: string; svg: string } | null>(null);
  const svg = diagram !== null && diagram.source === source ? diagram.svg : null;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: "base",
          fontFamily: tokenValue("--font-body") || "Inter, sans-serif",
          themeVariables: themeVariablesFromTokens(),
        });
        const rendered = await mermaid.render(`skill-diagram-${Date.now()}`, source);
        if (!cancelled) setDiagram({ source, svg: rendered.svg });
      } catch (cause) {
        // Leave the fallback — the source block below is the degraded surface.
        console.warn("Mermaid diagram render failed; showing source.", cause);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [source]);

  if (svg === null) {
    return (
      <pre className="text-doc-source overflow-auto whitespace-pre-wrap rounded-[var(--radius-sm)] border border-outline-variant bg-surface-high p-4">
        <code>{source}</code>
      </pre>
    );
  }

  return (
    <figure
      aria-label="Skill diagram"
      className="overflow-auto rounded-[var(--radius-sm)] border border-outline-variant bg-surface p-4 [&_svg]:mx-auto [&_svg]:max-w-full"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

function tokenValue(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** DESIGN §4 roles → Mermaid theme variables, read from the active theme. */
function themeVariablesFromTokens(): Record<string, string> {
  const surface = tokenValue("--surface");
  const surfaceHigh = tokenValue("--surface-high");
  const onSurface = tokenValue("--on-surface");
  const outlineVariant = tokenValue("--outline-variant");
  const primary = tokenValue("--primary");
  return {
    background: tokenValue("--background"),
    primaryColor: surfaceHigh,
    primaryTextColor: onSurface,
    primaryBorderColor: primary,
    secondaryColor: surface,
    tertiaryColor: surface,
    lineColor: tokenValue("--outline"),
    textColor: onSurface,
    nodeBorder: outlineVariant,
    mainBkg: surfaceHigh,
    edgeLabelBackground: surface,
    clusterBkg: surface,
    clusterBorder: outlineVariant,
    actorBkg: surfaceHigh,
    actorBorder: outlineVariant,
    actorTextColor: onSurface,
    signalColor: onSurface,
    signalTextColor: onSurface,
    labelBoxBkgColor: surface,
    labelBoxBorderColor: outlineVariant,
    noteBkgColor: surface,
    noteBorderColor: outlineVariant,
  };
}
