"use client";

import { useState } from "react";
import { Button } from "./ui/button";
import type { InteractionEntry, InteractionMode } from "./workspace";

/**
 * Slim right interaction panel — the demoted control surface beside the hero
 * (ARCHITECTURE §7, DESIGN §3.4 panel-width 300px). A typed drawer now; chosen
 * preview-primary so it can evolve into a voice-forward control without rework.
 */
export function InteractionPanel({
  entries,
  busy = false,
  mode = "build",
  className = "flex",
  onSend,
  onImport,
  onEquipment,
  onTemplates,
}: {
  entries: readonly InteractionEntry[];
  busy?: boolean;
  mode?: InteractionMode;
  /** Display classes from the shell (the mobile Chat | Skill tabs decide
   * visibility); must include the panel's display, e.g. "flex" or
   * "hidden lg:flex". */
  className?: string;
  onSend: (message: string) => void;
  onImport?: (raw: string) => void;
  onEquipment?: (raw: string) => void;
  onTemplates?: (query: string) => void;
}) {
  const [value, setValue] = useState("");

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    if (busy) return;
    if (mode === "import") {
      onImport?.(trimmed);
    } else if (mode === "equipment") {
      onEquipment?.(trimmed);
    } else if (mode === "templates") {
      onTemplates?.(trimmed);
    } else {
      onSend(trimmed);
    }
    setValue("");
  };

  const copy = copyForMode(mode);
  const acceptsInput =
    mode === "build" || mode === "import" || mode === "equipment" || mode === "templates";

  return (
    <aside
      className={`min-w-0 flex-1 flex-col bg-surface lg:w-[var(--spacing-panel)] lg:flex-none lg:border-l lg:border-outline-variant ${className}`}
    >
      <div className="border-b border-outline-variant px-4 py-3">
        <h2 className="text-label text-on-surface-variant">{copy.title}</h2>
      </div>

      <div className="flex flex-1 flex-col gap-3 overflow-auto px-4 py-4 text-doc-rendered">
        {entries.length === 0 ? (
          <div className="flex flex-col gap-2">
            <p className="text-on-surface-variant">{copy.empty}</p>
            {copy.hint && <p className="text-label text-on-surface-variant">{copy.hint}</p>}
          </div>
        ) : (
          entries.map((entry) => <InteractionEntryView key={entry.id} entry={entry} />)
        )}
      </div>

      {acceptsInput && (
        <div className="flex flex-col gap-2 border-t border-outline-variant p-3">
          <textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
            }}
            rows={3}
            placeholder={copy.placeholder}
            className="resize-none rounded-[var(--radius-sm)] border border-outline-variant bg-surface px-3 py-2 text-doc-rendered outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
          />
          <Button onClick={submit} variant="primary" disabled={busy}>
            {busy ? copy.busy : copy.button}
          </Button>
        </div>
      )}
    </aside>
  );
}

function InteractionEntryView({ entry }: { entry: InteractionEntry }) {
  const className =
    entry.tone === "error"
      ? "text-error"
      : entry.tone === "muted"
        ? "text-on-surface-variant"
        : "text-on-surface";

  if (entry.onAction) {
    return (
      <div className="flex flex-col gap-2 rounded-[var(--radius-sm)] border border-outline-variant p-3">
        <p className={className}>{entry.label}</p>
        <Button onClick={entry.onAction} variant="secondary">
          {entry.actionLabel ?? "Open"}
        </Button>
      </div>
    );
  }

  return <p className={className}>{entry.label}</p>;
}

function copyForMode(mode: InteractionMode): {
  title: string;
  empty: string;
  placeholder: string;
  button: string;
  busy: string;
  hint?: string;
} {
  if (mode === "equipment") {
    return {
      title: "Equipment",
      empty:
        "Describe the output you want — the authoring agent asks a few questions, then drafts the response schema with you. Or paste a response schema or tool contract to quality-check it. Checked tool contracts run with your next test run.",
      hint: 'Say "just draft it" if you don\'t want any questions before the first draft.',
      placeholder: "e.g. A schema for the invoice summaries my billing skill returns",
      button: "Send",
      busy: "Working…",
    };
  }
  if (mode === "import") {
    return {
      title: "Import a skill",
      empty: "Paste a SKILL.md document or a public GitHub URL to add it to your workspace.",
      placeholder: "https://github.com/acme/skills/tree/main/inbox\n\n---\nname: inbox-triage\ndescription: Sort unread email.\n---",
      button: "Import skill",
      busy: "Importing…",
    };
  }
  if (mode === "skills") {
    return {
      title: "My skills",
      empty: "No saved skills yet.",
      placeholder: "",
      button: "",
      busy: "",
    };
  }
  if (mode === "history") {
    return {
      title: "History",
      empty: "No saved runs yet.",
      placeholder: "",
      button: "",
      busy: "",
    };
  }
  if (mode === "templates") {
    return {
      title: "Templates",
      empty: "No Templates yet.",
      hint: "Reviewed skills show here. Direct Skill library links can still open published skills.",
      placeholder: "Search by name, owner, or slug",
      button: "Search",
      busy: "Searching…",
    };
  }
  return {
    title: "Describe your skill",
    empty:
      "Tell agent.branch what you want the skill to do — it writes it live in the document beside you.",
    hint: 'Say "just draft it" if you don\'t want any questions or advice before the first draft.',
    placeholder: "e.g. Sort my inbox into respond, archive, escalate",
    button: "Build skill",
    busy: "Building…",
  };
}
