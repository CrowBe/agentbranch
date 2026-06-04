"use client";

import { useState } from "react";
import type { BuildLoopEvent, BuildMessage } from "@/modules/build-loop";
import {
  createHeroArtifact,
  renderedRenderer,
  sourceRenderer,
  type RenderedDoc,
  type SourceDoc,
  type HeroView,
} from "@/modules/hero";
import { parseSkillMd, serializeSkillMd, type SkillSource } from "@/modules/skill";
import { TopBar } from "./top-bar";
import { SideRail } from "./side-rail";
import { HeroPanel } from "./hero-panel";
import { InteractionPanel, type InteractionEntry } from "./interaction-panel";

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
  const [heroDocs, setHeroDocs] = useState({ rendered, source });
  const [current, setCurrent] = useState<SkillSource | null>(null);
  const [messages, setMessages] = useState<BuildMessage[]>([]);
  const [entries, setEntries] = useState<InteractionEntry[]>([]);
  const [busy, setBusy] = useState(false);

  async function handleSend(message: string) {
    if (busy) return;
    const nextMessages: BuildMessage[] = [...messages, { role: "user", content: message }];
    setMessages(nextMessages);
    setEntries((prev) => [...prev, entry(message)]);
    setStatus("Building…");
    setBusy(true);
    let assistantText = "";
    let latestSource = current;

    try {
      const res = await fetch("/api/build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: nextMessages,
          current: latestSource ?? undefined,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        const error = body?.error ?? `Request failed (${res.status}).`;
        setStatus(error);
        setEntries((prev) => [...prev, entry(friendlyError(error), "error")]);
        return;
      }
      if (!res.body) {
        setStatus("Build stream did not open.");
        return;
      }

      for await (const event of readSseEvents(res.body)) {
        if (event.event === "text") {
          assistantText += event.data.delta;
          setEntries((prev) => upsertAssistant(prev, assistantText));
        } else if (event.event === "tool") {
          setStatus(event.data.phase === "call" ? `Running ${event.data.name}…` : "Updating preview…");
        } else if (event.event === "skill") {
          latestSource = event.data.source;
          setCurrent(latestSource);
          setHeroDocs(renderHeroDocs(latestSource));
        } else if (event.event === "skill-edit") {
          if (!latestSource) {
            setEntries((prev) => [...prev, entry("No draft exists to edit yet.", "error")]);
            continue;
          }
          const raw = serializeSkillMd(latestSource);
          const nextRaw = raw.replace(event.data.oldStr, event.data.newStr);
          if (nextRaw === raw) {
            setEntries((prev) => [...prev, entry("Could not apply the streamed edit.", "error")]);
            continue;
          }
          const parsed = parseSkillMd(nextRaw);
          if (!parsed.ok) {
            setEntries((prev) => [...prev, entry(parsed.error.message, "error")]);
            continue;
          }
          latestSource = parsed.value;
          setCurrent(latestSource);
          setHeroDocs(renderHeroDocs(latestSource));
        } else if (event.event === "error") {
          setStatus(friendlyError(event.data.message));
          setEntries((prev) => [...prev, entry(friendlyError(event.data.message), "error")]);
        } else if (event.event === "done") {
          setStatus("Build complete.");
        }
      }

      if (assistantText.trim()) {
        setMessages((prev) => [...prev, { role: "assistant", content: assistantText.trim() }]);
      }
    } catch (cause) {
      setStatus(String(cause));
      setEntries((prev) => [...prev, entry(String(cause), "error")]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-dvh flex-col">
      <TopBar onToggleMenu={() => setMenuExpanded((v) => !v)} />
      <div className="flex min-h-0 flex-1">
        <SideRail expanded={menuExpanded} />
        <main className="min-w-0 flex-1 overflow-hidden">
          <HeroPanel
            rendered={heroDocs.rendered}
            source={heroDocs.source}
            view={view}
            onViewChange={setView}
          />
          {status && (
            <p className="text-label px-6 pb-4 text-on-surface-variant" role="status">
              {status}
            </p>
          )}
        </main>
        <InteractionPanel entries={entries} busy={busy} onSend={handleSend} />
      </div>
    </div>
  );
}

function renderHeroDocs(source: SkillSource): { rendered: RenderedDoc; source: SourceDoc } {
  const artifact = createHeroArtifact(source);
  return {
    rendered: renderedRenderer.render(artifact),
    source: sourceRenderer.render(artifact),
  };
}

async function* readSseEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<BuildLoopEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const event = parseSseFrame(frame);
      if (event) yield event;
    }
  }

  buffer += decoder.decode();
  const event = parseSseFrame(buffer);
  if (event) yield event;
}

function parseSseFrame(frame: string): BuildLoopEvent | null {
  const lines = frame.split("\n");
  const event = lines.find((line) => line.startsWith("event: "))?.slice("event: ".length);
  const data = lines
    .filter((line) => line.startsWith("data: "))
    .map((line) => line.slice("data: ".length))
    .join("\n");

  if (!event || !data) return null;
  return { event, data: JSON.parse(data) } as BuildLoopEvent;
}

let entryId = 0;

function entry(label: string, tone?: InteractionEntry["tone"]): InteractionEntry {
  entryId += 1;
  return { id: String(entryId), label, tone };
}

function upsertAssistant(entries: InteractionEntry[], label: string): InteractionEntry[] {
  const last = entries.at(-1);
  if (last?.id === "assistant-stream") {
    return [...entries.slice(0, -1), { ...last, label }];
  }
  return [...entries, { id: "assistant-stream", label }];
}

function friendlyError(message: string): string {
  if (message.includes("cap_reached")) return "Out of free usage today.";
  if (message.includes("model_unavailable")) return "No model is configured.";
  return message;
}
