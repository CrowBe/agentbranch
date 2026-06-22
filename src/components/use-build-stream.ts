"use client";

import { useState } from "react";
import type { BuildLoopEvent, BuildMessage } from "@/modules/build-loop";
import {
  createHeroArtifact,
  renderedRenderer,
  sourceRenderer,
  type RenderedDoc,
  type SourceDoc,
} from "@/modules/hero";
import { applySkillEdit, type SkillSource } from "@/modules/skill";
import { readSseEvents } from "@/shared";
import type { InteractionEntry } from "./interaction-panel";
import type { ToolAction } from "./tool-chips";

export function useBuildStream({
  rendered,
  source,
  initialSkill,
  onBuildStart,
  onStreamSkillChange,
}: {
  rendered: RenderedDoc;
  source: SourceDoc;
  initialSkill: SkillSource;
  onBuildStart: () => void;
  onStreamSkillChange: () => void;
}) {
  const [status, setStatus] = useState<string | null>(null);
  const [heroDocs, setHeroDocs] = useState({ rendered, source });
  const [current, setCurrent] = useState<SkillSource | null>(initialSkill);
  const [currentSkillId, setCurrentSkillId] = useState<string | null>(null);
  const [messages, setMessages] = useState<BuildMessage[]>([]);
  const [entries, setEntries] = useState<InteractionEntry[]>([]);
  const [busy, setBusy] = useState(false);

  async function send(message: string) {
    if (busy) return;
    await sendBuild(message, messages, current, currentSkillId, true);
  }

  async function sendBuild(
    message: string,
    priorMessages: readonly BuildMessage[],
    startingSource: SkillSource | null,
    startingSkillId: string | null,
    allowLintAutoFeedback: boolean,
  ) {
    onBuildStart();
    const nextMessages: BuildMessage[] = [...priorMessages, { role: "user", content: message }];
    setMessages(nextMessages);
    setEntries((prev) => [...prev, entry(message)]);
    setStatus("Building...");
    setBusy(true);
    onStreamSkillChange();
    let assistantText = "";
    let latestSource = startingSource;
    let latestSkillId = startingSkillId;
    let completedMessages: readonly BuildMessage[] = nextMessages;
    let pendingLintFeedback: string | null = null;
    let completed = false;

    try {
      const res = await fetch("/api/build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: nextMessages,
          current: latestSource ?? undefined,
          currentSkillId: latestSkillId ?? undefined,
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

      for await (const event of readSseEvents<BuildLoopEvent>(res.body)) {
        if (event.event === "text") {
          assistantText += event.data.delta;
          setEntries((prev) => upsertAssistant(prev, assistantText));
        } else if (event.event === "tool") {
          setStatus(event.data.phase === "call" ? `Running ${event.data.name}...` : "Updating preview...");
        } else if (event.event === "skill") {
          latestSource = event.data.source;
          setCurrent(latestSource);
          setHeroDocs(renderHeroDocs(latestSource));
          onStreamSkillChange();
        } else if (event.event === "lint-feedback") {
          pendingLintFeedback = event.data.feedback;
        } else if (event.event === "skill-checkpoint") {
          latestSkillId = event.data.skillId;
          setCurrentSkillId(event.data.skillId);
        } else if (event.event === "skill-edit") {
          if (!latestSource) {
            setEntries((prev) => [...prev, entry("No draft exists to edit yet.", "error")]);
            continue;
          }
          const edited = applySkillEdit(latestSource, event.data.oldStr, event.data.newStr);
          if (!edited.ok) {
            setEntries((prev) => [...prev, entry(edited.error.message, "error")]);
            continue;
          }
          latestSource = edited.value;
          setCurrent(latestSource);
          setHeroDocs(renderHeroDocs(latestSource));
          onStreamSkillChange();
        } else if (event.event === "error") {
          setStatus(friendlyError(event.data.message));
          setEntries((prev) => [...prev, entry(friendlyError(event.data.message), "error")]);
        } else if (event.event === "done") {
          if (event.data.skillId) {
            latestSkillId = event.data.skillId;
            setCurrentSkillId(event.data.skillId);
          }
          setStatus("Build complete.");
          completed = true;
        }
      }

      if (assistantText.trim()) {
        completedMessages = [...nextMessages, { role: "assistant", content: assistantText.trim() }];
        setMessages([...completedMessages]);
      }
    } catch (cause) {
      setStatus(String(cause));
      setEntries((prev) => [...prev, entry(String(cause), "error")]);
    } finally {
      setBusy(false);
    }

    if (
      completed &&
      pendingLintFeedback &&
      allowLintAutoFeedback &&
      !isLintFeedbackMessage(message)
    ) {
      await sendBuild(pendingLintFeedback, completedMessages, latestSource, latestSkillId, false);
    }
  }

  return {
    status,
    setStatus,
    heroDocs,
    setHeroDocs,
    current,
    setCurrent,
    currentSkillId,
    setCurrentSkillId,
    entries,
    setEntries,
    busy,
    setBusy,
    send,
  };
}

export function renderHeroDocs(source: SkillSource): { rendered: RenderedDoc; source: SourceDoc } {
  const artifact = createHeroArtifact(source);
  return {
    rendered: renderedRenderer.render(artifact),
    source: sourceRenderer.render(artifact),
  };
}

let entryId = 0;

export function entry(label: string, tone?: InteractionEntry["tone"]): InteractionEntry {
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

function isLintFeedbackMessage(message: string): boolean {
  return message.startsWith("Lint - Quality ");
}

export function friendlyError(message: string): string {
  if (message.includes("cap_reached")) return "Out of free usage today.";
  if (message.includes("model_unavailable")) return "No model is configured.";
  return message;
}

export function toolLabel(action: ToolAction): string {
  if (action === "visualise") return "Visualise";
  if (action === "test-run") return "Test run";
  if (action === "triggering-eval") return "Triggering eval";
  return "Export";
}
