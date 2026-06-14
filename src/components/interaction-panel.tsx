"use client";

import { useState } from "react";
import { Button } from "./ui/button";

export type InteractionEntry = {
  readonly id: string;
  readonly label: string;
  readonly tone?: "muted" | "error";
};

/**
 * Slim right interaction panel — the demoted control surface beside the hero
 * (ARCHITECTURE §7, DESIGN §3.4 panel-width 300px). A typed drawer now; chosen
 * preview-primary so it can evolve into a voice-forward control without rework.
 */
export function InteractionPanel({
  entries,
  busy = false,
  mode = "build",
  onSend,
  onImport,
}: {
  entries: readonly InteractionEntry[];
  busy?: boolean;
  mode?: "build" | "import";
  onSend: (message: string) => void;
  onImport?: (raw: string) => void;
}) {
  const [value, setValue] = useState("");

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    if (busy) return;
    if (mode === "import") {
      onImport?.(trimmed);
    } else {
      onSend(trimmed);
    }
    setValue("");
  };

  const copy =
    mode === "import"
      ? {
          title: "Import a skill",
          empty: "Paste a SKILL.md document or a public GitHub URL to add it to your workspace.",
          placeholder: "https://github.com/acme/skills/tree/main/inbox\n\n---\nname: inbox-triage\ndescription: Sort unread email.\n---",
          button: "Import skill",
          busy: "Importing...",
        }
      : {
          title: "Describe your skill",
          empty:
            "Tell SkillSmith what you want the skill to do — it writes it live in the document beside you.",
          placeholder: "e.g. Sort my inbox into respond, archive, escalate",
          button: "Build skill",
          busy: "Building...",
        };

  return (
    <aside
      className="flex shrink-0 flex-col border-l border-outline-variant bg-surface"
      style={{ width: "var(--spacing-panel)" }}
    >
      <div className="border-b border-outline-variant px-4 py-3">
        <h2 className="text-label text-on-surface-variant">{copy.title}</h2>
      </div>

      <div className="flex flex-1 flex-col gap-3 overflow-auto px-4 py-4 text-doc-rendered">
        {entries.length === 0 ? (
          <p className="text-on-surface-variant">{copy.empty}</p>
        ) : (
          entries.map((entry) => (
            <p
              key={entry.id}
              className={
                entry.tone === "error"
                  ? "text-error"
                  : entry.tone === "muted"
                    ? "text-on-surface-variant"
                    : "text-on-surface"
              }
            >
              {entry.label}
            </p>
          ))
        )}
      </div>

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
    </aside>
  );
}
