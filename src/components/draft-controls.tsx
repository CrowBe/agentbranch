"use client";

import { Button } from "./ui/button";

/** A draft in progress, summarised for the resume affordance (ARCHITECTURE §9.3). */
export type DraftSummary = {
  readonly id: string;
  readonly revision: number | null;
  readonly name: string | null;
  readonly description: string | null;
};

/**
 * State legibility + promote/discard for branching iteration (ARCHITECTURE §9.3,
 * issue #129). Makes it obvious whether the hero is the blessed **main version**
 * or an in-progress **draft**, and lets the user set a draft as the main version
 * or throw it away. Copy is deliberately git-jargon-free (DESIGN §1 tone): draft
 * / main version, never branch / merge / commit / promote.
 */
export function DraftControls({
  onDraft,
  canStartDraft,
  openDrafts,
  busy,
  onStartDraft,
  onOpenDraft,
  onPromote,
  onDiscard,
}: {
  /** True when the hero is showing a draft; false when it is the main version. */
  onDraft: boolean;
  /** Only a saved skill with a main version can spawn a draft. */
  canStartDraft: boolean;
  openDrafts: readonly DraftSummary[];
  busy: boolean;
  onStartDraft: () => void;
  onOpenDraft: (id: string) => void;
  onPromote: () => void;
  onDiscard: () => void;
}) {
  if (onDraft) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-md)] border border-primary/40 bg-primary/5 px-4 py-3">
        <div className="flex flex-col gap-0.5">
          <p className="text-label text-primary">Editing a draft</p>
          <p className="text-body-sm text-on-surface-variant">
            Your main version stays as it is until you set this draft as the main version.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="secondary" disabled={busy} onClick={onDiscard}>
            Discard draft
          </Button>
          <Button variant="primary" disabled={busy} onClick={onPromote}>
            Set as main version
          </Button>
        </div>
      </div>
    );
  }

  if (!canStartDraft) return null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-md)] border border-outline-variant bg-surface px-4 py-3">
      <div className="flex flex-col gap-0.5">
        <p className="text-label text-on-surface-variant">Viewing the main version</p>
        <p className="text-body-sm text-on-surface-variant">
          Start a draft to iterate and test changes without touching your main version.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {openDrafts.map((draft) => (
          <Button
            key={draft.id}
            variant="secondary"
            disabled={busy}
            onClick={() => onOpenDraft(draft.id)}
          >
            {resumeLabel(draft)}
          </Button>
        ))}
        <Button variant="primary" disabled={busy} onClick={onStartDraft}>
          Start a draft
        </Button>
      </div>
    </div>
  );
}

function resumeLabel(draft: DraftSummary): string {
  return draft.revision && draft.revision > 1 ? `Resume draft (${draft.revision} edits)` : "Resume draft";
}
