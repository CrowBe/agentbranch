"use client";

import { useState, type FormEvent } from "react";
import { Button } from "./ui/button";

export function PublishControls({
  skillName,
  busy,
  onPublish,
}: {
  skillName: string;
  busy: boolean;
  onPublish: (owner: string, name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [owner, setOwner] = useState("");
  const [name, setName] = useState(skillName);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedOwner = slugPart(owner);
    const normalizedName = slugPart(name);
    if (!normalizedOwner || !normalizedName) return;
    setOpen(false);
    onPublish(normalizedOwner, normalizedName);
  }

  return (
    <div className="px-4 pb-3 lg:px-6">
      <Button variant="secondary" disabled={busy} onClick={() => setOpen(true)}>
        Publish
      </Button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim/40 p-4">
          <form
            aria-label="Publish skill"
            className="elevation-overlay flex w-full max-w-md flex-col gap-4 rounded-[var(--radius-lg)] border border-outline-variant bg-surface p-5"
            onSubmit={submit}
          >
            <div>
              <h2 className="text-headline-md text-on-surface">Publish this main version</h2>
              <p className="text-body-sm mt-1 text-on-surface-variant">
                Publishing is open. This skill will be public and labelled with its safety-rating state.
              </p>
            </div>
            <label className="text-label flex flex-col gap-1 text-on-surface">
              Owner
              <input
                className="rounded-[var(--radius-sm)] border border-outline-variant bg-surface px-3 py-2"
                required
                value={owner}
                onChange={(event) => setOwner(event.target.value)}
                placeholder="your-name"
              />
            </label>
            <label className="text-label flex flex-col gap-1 text-on-surface">
              Skill name
              <input
                className="rounded-[var(--radius-sm)] border border-outline-variant bg-surface px-3 py-2"
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" type="button" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button variant="primary" type="submit">
                Publish skill
              </Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function slugPart(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
}
