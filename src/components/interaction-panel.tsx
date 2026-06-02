"use client";

import { useState } from "react";
import { Button } from "./ui/button";

/**
 * Slim right interaction panel — the demoted control surface beside the hero
 * (ARCHITECTURE §7, DESIGN §3.4 panel-width 300px). A typed drawer now; chosen
 * preview-primary so it can evolve into a voice-forward control without rework.
 */
export function InteractionPanel({ onSend }: { onSend: (message: string) => void }) {
  const [value, setValue] = useState("");

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setValue("");
  };

  return (
    <aside
      className="flex shrink-0 flex-col border-l border-outline-variant bg-surface"
      style={{ width: "var(--spacing-panel)" }}
    >
      <div className="border-b border-outline-variant px-4 py-3">
        <h2 className="text-label text-on-surface-variant">Describe your skill</h2>
      </div>

      <div className="flex-1 overflow-auto px-4 py-4 text-doc-rendered text-on-surface-variant">
        Tell SkillBuilder what you want the skill to do — it writes it live in the
        document beside you.
      </div>

      <div className="flex flex-col gap-2 border-t border-outline-variant p-3">
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
          }}
          rows={3}
          placeholder="e.g. Sort my inbox into respond, archive, escalate"
          className="resize-none rounded-[var(--radius-sm)] border border-outline-variant bg-surface px-3 py-2 text-doc-rendered outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
        />
        <Button onClick={submit} variant="primary">
          Build skill
        </Button>
      </div>
    </aside>
  );
}
