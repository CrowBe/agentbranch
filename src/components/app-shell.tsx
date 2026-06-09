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
import {
  HeroPanel,
  type CapabilityPanel,
  type EvaluationBreakdown,
  type EvaluationToolAction,
  type InsightPanel,
} from "./hero-panel";
import { InteractionPanel, type InteractionEntry } from "./interaction-panel";
import type { ToolAction } from "./tool-chips";

/**
 * The app shell — composes the chrome top bar, collapsible left rail,
 * preview-primary hero, and slim right interaction panel (ARCHITECTURE §7).
 * Holds only presentation state; the hero content is computed server-side via
 * the skill-analysis seam and passed in.
 */
export function AppShell({
  rendered,
  source,
  initialSkill,
}: {
  rendered: RenderedDoc;
  source: SourceDoc;
  initialSkill: SkillSource;
}) {
  const [menuExpanded, setMenuExpanded] = useState(false);
  const [view, setView] = useState<HeroView>("rendered");
  const [status, setStatus] = useState<string | null>(null);
  const [heroDocs, setHeroDocs] = useState({ rendered, source });
  const [current, setCurrent] = useState<SkillSource | null>(initialSkill);
  const [currentSkillId, setCurrentSkillId] = useState<string | null>(null);
  const [messages, setMessages] = useState<BuildMessage[]>([]);
  const [entries, setEntries] = useState<InteractionEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [toolBusy, setToolBusy] = useState(false);
  const [activeTool, setActiveTool] = useState<ToolAction | null>(null);
  const [capability, setCapability] = useState<CapabilityPanel | null>(null);

  async function handleSend(message: string) {
    if (busy) return;
    const nextMessages: BuildMessage[] = [...messages, { role: "user", content: message }];
    setMessages(nextMessages);
    setEntries((prev) => [...prev, entry(message)]);
    setStatus("Building…");
    setBusy(true);
    setCapability(null);
    setActiveTool(null);
    let assistantText = "";
    let latestSource = current;

    try {
      const res = await fetch("/api/build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: nextMessages,
          current: latestSource ?? undefined,
          currentSkillId: currentSkillId ?? undefined,
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
          setCapability(null);
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
          setCapability(null);
        } else if (event.event === "error") {
          setStatus(friendlyError(event.data.message));
          setEntries((prev) => [...prev, entry(friendlyError(event.data.message), "error")]);
        } else if (event.event === "done") {
          if (event.data.skillId) setCurrentSkillId(event.data.skillId);
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
            capability={capability}
            activeTool={activeTool}
            toolBusy={toolBusy}
            onToolSelect={handleToolSelect}
            onEvaluationSurfaceChange={handleEvaluationSurfaceSelect}
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

  async function handleToolSelect(action: ToolAction) {
    await runTool(action, "insights");
  }

  async function handleEvaluationSurfaceSelect(surface: "insights" | "breakdown") {
    if (!activeTool || !isEvaluationTool(activeTool)) return;
    await runTool(activeTool, surface);
  }

  async function runTool(action: ToolAction, surface: "insights" | "breakdown") {
    const skill = current;
    if (!skill || toolBusy) return;

    setActiveTool(action);
    setToolBusy(true);
    setCapability(null);
    setStatus(`${toolLabel(action)} running...`);

    try {
      const res = await fetch(`/${apiPath(action)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          skill,
          currentSkillId: currentSkillId ?? undefined,
          surface,
        }),
      });
      const body = (await res.json().catch(() => null)) as unknown;
      if (!res.ok) {
        const error = parseError(body, res.status, action);
        setStatus(error);
        setEntries((prev) => [...prev, entry(error, "error")]);
        return;
      }
      setCapability(toCapabilityPanel(action, surface, body));
      setStatus(`${toolLabel(action)} ready.`);
    } catch (cause) {
      const error = friendlyError(String(cause));
      setStatus(error);
      setEntries((prev) => [...prev, entry(error, "error")]);
    } finally {
      setToolBusy(false);
    }
  }
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

function apiPath(action: ToolAction): string {
  if (action === "visualise") return "api/visualise";
  if (action === "test-run") return "api/test-run";
  if (action === "triggering-eval") return "api/triggering-eval";
  return "api/export";
}

function toolLabel(action: ToolAction): string {
  if (action === "visualise") return "Visualise";
  if (action === "test-run") return "Test run";
  if (action === "triggering-eval") return "Triggering eval";
  return "Export";
}

function parseError(body: unknown, status: number, action: ToolAction): string {
  const error = body && typeof body === "object" && "error" in body ? String(body.error) : "";
  const code = body && typeof body === "object" && "code" in body ? String(body.code) : "";
  if (code === "cap_reached" && action === "triggering-eval") {
    return "Triggering eval is not available on the free plan.";
  }
  if (code === "cap_reached") return "Out of free usage today.";
  if (code === "model_unavailable" || code === "not_configured") return "No model is configured.";
  return friendlyError(error || `Request failed (${status}).`);
}

function toCapabilityPanel(
  action: ToolAction,
  surface: "insights" | "breakdown",
  body: unknown,
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
      return { kind: "breakdown", action, title: toolLabel(action), breakdown };
    }
  }

  if (isEvaluationTool(action) && isInsight(body)) {
    return { kind: "insights", action, title: toolLabel(action), insight: body };
  }

  throw new Error("Capability returned an unexpected response.");
}

function isEvaluationTool(action: ToolAction): action is EvaluationToolAction {
  return action === "test-run" || action === "triggering-eval";
}

function toEvaluationBreakdown(
  action: EvaluationToolAction,
  body: unknown,
): EvaluationBreakdown | null {
  if (action === "test-run" && isTestRunBreakdown(body)) {
    return { kind: "test-run", scenario: body.scenario, transcript: body.transcript };
  }
  if (action === "triggering-eval" && isTriggeringBreakdown(body)) {
    return { kind: "triggering-eval", passed: body.passed, cases: body.cases };
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function isExportFile(value: unknown): value is { readonly path: string; readonly contents: string } {
  return (
    isRecord(value) &&
    typeof value.path === "string" &&
    typeof value.contents === "string"
  );
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
