"use client";

import { useState } from "react";
import type { RenderedDoc, SourceDoc, HeroView } from "@/modules/hero";
import { TopBar } from "./top-bar";
import { SideRail } from "./side-rail";
import { HeroPanel } from "./hero-panel";
import { InteractionPanel } from "./interaction-panel";

/**
 * The app shell — composes the chrome top bar, collapsible left rail,
 * preview-primary hero, and slim right interaction panel (ARCHITECTURE §7).
 * Holds only presentation state; the hero content is computed server-side via
 * the skill-analysis seam and passed in.
 */
export function AppShell({
  rendered,
  source,
}: {
  rendered: RenderedDoc;
  source: SourceDoc;
}) {
  const [menuExpanded, setMenuExpanded] = useState(false);
  const [view, setView] = useState<HeroView>("rendered");
  const [status, setStatus] = useState<string | null>(null);

  async function handleSend(message: string) {
    setStatus("Building…");
    try {
      const res = await fetch("/api/build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "user", content: message }] }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setStatus(body?.error ?? `Request failed (${res.status}).`);
        return;
      }
      // The route streams SSE; the shell just confirms the wiring for now.
      setStatus("Connected to the build loop.");
    } catch (cause) {
      setStatus(String(cause));
    }
  }

  return (
    <div className="flex h-dvh flex-col">
      <TopBar onToggleMenu={() => setMenuExpanded((v) => !v)} />
      <div className="flex min-h-0 flex-1">
        <SideRail expanded={menuExpanded} />
        <main className="min-w-0 flex-1 overflow-hidden">
          <HeroPanel rendered={rendered} source={source} view={view} onViewChange={setView} />
          {status && (
            <p className="text-label px-6 pb-4 text-on-surface-variant" role="status">
              {status}
            </p>
          )}
        </main>
        <InteractionPanel onSend={handleSend} />
      </div>
    </div>
  );
}
