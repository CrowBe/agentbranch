"use client";

import { useEffect, useState } from "react";
import type { ProviderStatus, RouterSnapshot } from "@/modules/model-router";
import { Button } from "./ui/button";
import { Pill } from "./ui/pill";

/**
 * Model console — the runtime surface for provider/model selection and auth
 * (ARCHITECTURE §4 routing; §7 shell). Reads the secret-free registry from the
 * model router, switches the active provider/model, and stores or clears a
 * bring-your-own key. Keys are write-only here: typed in, POSTed, never returned
 * (the snapshot reports presence as a pill, not the value).
 *
 * Rendered as an overlay over the preview-primary shell, opened from the rail.
 */
export function ModelConsole({ onClose }: { onClose: () => void }) {
  const [snapshot, setSnapshot] = useState<RouterSnapshot | null>(null);
  const [status, setStatus] = useState<string | null>("Loading models…");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await readSnapshot();
      if (cancelled) return;
      if (result.ok) {
        setSnapshot(result.snapshot);
        setStatus(null);
      } else {
        setStatus(result.error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function send(command: ConsoleCommand, pending: string): Promise<void> {
    if (busy) return;
    setBusy(true);
    setStatus(pending);
    const result = await postCommand(command);
    if (result.ok) {
      setSnapshot(result.snapshot);
      setStatus("Saved.");
    } else {
      setStatus(result.error);
    }
    setBusy(false);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-scrim/40 p-6 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="Models"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85dvh] w-full max-w-2xl flex-col overflow-hidden rounded-[var(--radius-xl)] border border-outline-variant bg-surface shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-outline-variant px-6 py-4">
          <div>
            <h2 className="text-title font-display">Models</h2>
            <p className="text-label text-on-surface-variant">
              Pick the provider and model for this session, or connect your own key.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="rounded-[var(--radius-sm)] px-2 py-1 text-on-surface-variant hover:bg-surface-high"
          >
            ✕
          </button>
        </header>

        <div className="flex flex-col gap-3 overflow-y-auto px-6 py-4">
          {snapshot ? (
            snapshot.providers.map((provider) => (
              <ProviderCard
                key={provider.id}
                provider={provider}
                active={provider.id === snapshot.active.providerId}
                activeModel={
                  provider.id === snapshot.active.providerId
                    ? snapshot.active.modelIds?.default ?? provider.modelIds.default
                    : provider.modelIds.default
                }
                busy={busy}
                onSelect={(modelIds) =>
                  send(
                    { action: "select", providerId: provider.id, modelIds },
                    `Switching to ${provider.label}…`,
                  )
                }
                onSaveKey={(apiKey) =>
                  send(
                    { action: "set-credential", providerId: provider.id, apiKey },
                    `Saving key for ${provider.label}…`,
                  )
                }
                onClearKey={() =>
                  send(
                    { action: "clear-credential", providerId: provider.id },
                    `Clearing key for ${provider.label}…`,
                  )
                }
              />
            ))
          ) : (
            <p className="text-body text-on-surface-variant">No providers available.</p>
          )}
        </div>

        {status && (
          <footer className="text-label border-t border-outline-variant px-6 py-3 text-on-surface-variant" role="status">
            {status}
          </footer>
        )}
      </div>
    </div>
  );
}

function ProviderCard({
  provider,
  active,
  activeModel,
  busy,
  onSelect,
  onSaveKey,
  onClearKey,
}: {
  provider: ProviderStatus;
  active: boolean;
  activeModel: string;
  busy: boolean;
  onSelect: (modelIds?: { default: string }) => void;
  onSaveKey: (apiKey: string) => void;
  onClearKey: () => void;
}) {
  const [model, setModel] = useState(activeModel);
  const [apiKey, setApiKey] = useState("");
  // Re-sync the editable field when the saved model changes (e.g. after Apply),
  // without an effect — the React-recommended "adjust state during render" pattern.
  const [lastActiveModel, setLastActiveModel] = useState(activeModel);
  if (activeModel !== lastActiveModel) {
    setLastActiveModel(activeModel);
    setModel(activeModel);
  }

  return (
    <section
      className={`rounded-[var(--radius-md)] border p-4 ${
        active ? "border-primary bg-primary/5" : "border-outline-variant"
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <label className="flex items-center gap-2.5">
          <input
            type="radio"
            name="active-provider"
            checked={active}
            disabled={busy || !provider.ready}
            onChange={() => onSelect()}
            className="accent-primary"
          />
          <span className="text-body font-medium">{provider.label}</span>
        </label>
        <div className="flex items-center gap-1.5">
          {provider.ready ? <Pill tone="success">ready</Pill> : <Pill tone="neutral">no key</Pill>}
          {provider.hasServerKey && <Pill tone="neutral">server key</Pill>}
          {provider.hasByoKey && <Pill tone="warn">your key</Pill>}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="flex flex-1 flex-col gap-1">
          <span className="text-label text-on-surface-variant">Default model</span>
          <input
            type="text"
            value={model}
            disabled={busy}
            onChange={(event) => setModel(event.target.value)}
            className="rounded-[var(--radius-sm)] border border-outline-variant bg-surface px-2.5 py-1.5 font-mono text-label"
          />
        </label>
        <Button
          variant="secondary"
          disabled={busy || model.trim().length === 0 || (active && model === activeModel)}
          onClick={() => onSelect({ default: model.trim() })}
        >
          {active ? "Apply model" : "Use this"}
        </Button>
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="flex flex-1 flex-col gap-1">
          <span className="text-label text-on-surface-variant">
            Your API key {provider.hasByoKey && "(stored — replace or clear)"}
          </span>
          <input
            type="password"
            value={apiKey}
            autoComplete="off"
            placeholder={provider.hasServerKey ? "Override the server key" : "Connect your own key"}
            disabled={busy}
            onChange={(event) => setApiKey(event.target.value)}
            className="rounded-[var(--radius-sm)] border border-outline-variant bg-surface px-2.5 py-1.5 font-mono text-label"
          />
        </label>
        <Button
          variant="secondary"
          disabled={busy || apiKey.trim().length === 0}
          onClick={() => {
            onSaveKey(apiKey.trim());
            setApiKey("");
          }}
        >
          Save key
        </Button>
        {provider.hasByoKey && (
          <Button variant="secondary" disabled={busy} onClick={onClearKey}>
            Clear
          </Button>
        )}
      </div>
    </section>
  );
}

type ConsoleCommand =
  | { action: "select"; providerId: string; modelIds?: { default: string } }
  | { action: "set-credential"; providerId: string; apiKey: string }
  | { action: "clear-credential"; providerId: string };

type SnapshotResult =
  | { ok: true; snapshot: RouterSnapshot }
  | { ok: false; error: string };

async function readSnapshot(): Promise<SnapshotResult> {
  try {
    const res = await fetch("/api/model-router", { headers: { Accept: "application/json" } });
    return toSnapshotResult(res);
  } catch (cause) {
    return { ok: false, error: String(cause) };
  }
}

async function postCommand(command: ConsoleCommand): Promise<SnapshotResult> {
  try {
    const res = await fetch("/api/model-router", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(command),
    });
    return toSnapshotResult(res);
  } catch (cause) {
    return { ok: false, error: String(cause) };
  }
}

async function toSnapshotResult(res: Response): Promise<SnapshotResult> {
  const body = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    const error =
      body && typeof body === "object" && "error" in body
        ? String((body as { error: unknown }).error)
        : `Request failed (${res.status}).`;
    return { ok: false, error };
  }
  if (isRouterSnapshot(body)) return { ok: true, snapshot: body };
  return { ok: false, error: "Models returned an unexpected response." };
}

function isRouterSnapshot(value: unknown): value is RouterSnapshot {
  return (
    value !== null &&
    typeof value === "object" &&
    "providers" in value &&
    Array.isArray((value as { providers: unknown }).providers) &&
    "active" in value
  );
}
