"use client";

import { useRef, useState } from "react";
import { IMPORT_TIERS, type ImportTier } from "@/modules/import";
import { Button } from "./ui/button";
import type {
  AgentConfigurationImportInput,
  InteractionEntry,
  InteractionMode,
} from "./workspace";

/**
 * Slim right interaction panel — the demoted control surface beside the hero
 * (ARCHITECTURE §7, DESIGN §3.4 panel-width 300px). A typed drawer now; chosen
 * preview-primary so it can evolve into a voice-forward control without rework.
 */
export function InteractionPanel({
  entries,
  busy = false,
  mode = "build",
  importTier = "primitive",
  className = "flex",
  onSend,
  onImport,
  onImportTier,
  onImportRelated,
  onImportAgentConfiguration,
  onEquipment,
  onEquipmentHelp,
  onTemplates,
}: {
  entries: readonly InteractionEntry[];
  busy?: boolean;
  mode?: InteractionMode;
  importTier?: ImportTier;
  /** Display classes from the shell (the mobile Chat | Skill tabs decide
   * visibility); must include the panel's display, e.g. "flex" or
   * "hidden lg:flex". */
  className?: string;
  onSend: (message: string) => void;
  onImport?: (raw: string) => void;
  onImportTier?: (tier: ImportTier) => void;
  onImportRelated?: (documents: readonly string[]) => void;
  onImportAgentConfiguration?: (input: AgentConfigurationImportInput) => void;
  onEquipment?: (raw: string) => void;
  onEquipmentHelp?: () => void;
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

  const copy = copyForMode(mode, importTier);
  // The upper rungs take files, not prose: several documents, or one archive.
  const importTakesFiles = mode === "import" && importTier !== "primitive";
  const acceptsInput =
    !importTakesFiles &&
    (mode === "build" || mode === "import" || mode === "equipment" || mode === "templates");

  return (
    <aside
      className={`min-w-0 flex-1 flex-col bg-surface lg:w-[var(--spacing-panel)] lg:flex-none lg:border-l lg:border-outline-variant ${className}`}
    >
      <div className="border-b border-outline-variant px-4 py-3">
        <h2 className="text-label text-on-surface-variant">{copy.title}</h2>
      </div>

      {mode === "import" && onImportTier ? (
        <ImportTierChooser value={importTier} disabled={busy} onChange={onImportTier} />
      ) : null}

      <div className="flex flex-1 flex-col gap-3 overflow-auto px-4 py-4 text-doc-rendered">
        {entries.length === 0 ? (
          <div className="flex flex-col gap-2">
            <p className="text-on-surface-variant">{copy.empty}</p>
            {mode === "equipment" && onEquipmentHelp ? (
              <p className="text-label text-on-surface-variant">
                Not sure which one fits?{" "}
                <button
                  type="button"
                  onClick={onEquipmentHelp}
                  className="text-primary underline underline-offset-2 hover:no-underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                >
                  Choose the right building block
                </button>
                .
              </p>
            ) : null}
            {copy.hint && <p className="text-label text-on-surface-variant">{copy.hint}</p>}
          </div>
        ) : (
          entries.map((entry) => <InteractionEntryView key={entry.id} entry={entry} />)
        )}
      </div>

      {importTakesFiles && (
        <ImportFilePicker
          tier={importTier}
          busy={busy}
          copy={copy}
          onRelated={onImportRelated}
          onArchive={onImportAgentConfiguration}
        />
      )}

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

/**
 * The import ladder's three rungs, in ascending order of complexity
 * (ARCHITECTURE §10). A vertical list rather than a segmented control: each
 * rung needs its one-line summary to be choosable, and the summary is what
 * tells an SMB owner they are allowed to start at the bottom.
 */
function ImportTierChooser({
  value,
  disabled,
  onChange,
}: {
  value: ImportTier;
  disabled: boolean;
  onChange: (tier: ImportTier) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-1 border-b border-outline-variant px-3 py-3">
      <legend className="text-label px-1 text-on-surface-variant">What are you bringing in?</legend>
      {IMPORT_TIERS.map((rung) => (
        <button
          key={rung.tier}
          type="button"
          aria-pressed={rung.tier === value}
          disabled={disabled}
          onClick={() => onChange(rung.tier)}
          className={`flex flex-col gap-0.5 rounded-[var(--radius-sm)] px-2 py-2 text-left transition-colors ${
            rung.tier === value
              ? "bg-primary/15 text-primary"
              : "text-on-surface-variant hover:bg-surface-high"
          } disabled:cursor-not-allowed disabled:opacity-60`}
        >
          <span className="text-label">{rung.label}</span>
          <span className="text-label opacity-80">{rung.summary}</span>
        </button>
      ))}
    </fieldset>
  );
}

const ARCHIVE_FORMATS: readonly { suffix: string; format: AgentConfigurationImportInput["format"] }[] = [
  { suffix: ".tar.gz", format: "tar.gz" },
  { suffix: ".tgz", format: "tar.gz" },
  { suffix: ".tar", format: "tar" },
  { suffix: ".zip", format: "zip" },
];

/** The upper rungs take files. Reading them here keeps the store DOM-free. */
function ImportFilePicker({
  tier,
  busy,
  copy,
  onRelated,
  onArchive,
}: {
  tier: ImportTier;
  busy: boolean;
  copy: { button: string; busy: string };
  onRelated?: (documents: readonly string[]) => void;
  onArchive?: (input: AgentConfigurationImportInput) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [chosen, setChosen] = useState<readonly File[]>([]);
  const related = tier === "related-primitives";

  const submit = async () => {
    if (busy || chosen.length === 0) return;
    if (related) {
      onRelated?.(await Promise.all(chosen.map((file) => file.text())));
    } else {
      const file = chosen[0];
      if (!file) return;
      const match = ARCHIVE_FORMATS.find(({ suffix }) =>
        file.name.toLowerCase().endsWith(suffix),
      );
      if (!match) return;
      onArchive?.({ name: file.name, format: match.format, bytes: await file.arrayBuffer() });
    }
    setChosen([]);
    if (input.current) input.current.value = "";
  };

  return (
    <div className="flex flex-col gap-2 border-t border-outline-variant p-3">
      <input
        ref={input}
        type="file"
        multiple={related}
        accept={related ? ".md,.json,.txt" : ".zip,.tar,.tar.gz,.tgz"}
        aria-label={related ? "Documents to import" : "Agent configuration archive"}
        onChange={(e) => setChosen(Array.from(e.target.files ?? []))}
        className="text-label file:mr-2 file:rounded-[var(--radius-sm)] file:border file:border-outline-variant file:bg-surface file:px-2 file:py-1 file:text-on-surface"
      />
      <Button onClick={() => void submit()} variant="primary" disabled={busy || chosen.length === 0}>
        {busy ? copy.busy : copy.button}
      </Button>
    </div>
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
        <div className="flex gap-2">
          <Button onClick={entry.onAction} variant="secondary">{entry.actionLabel ?? "Open"}</Button>
          {entry.onSecondaryAction && <Button onClick={entry.onSecondaryAction} variant="secondary">{entry.secondaryActionLabel ?? "Remove"}</Button>}
        </div>
      </div>
    );
  }

  return <p className={className}>{entry.label}</p>;
}

function copyForMode(
  mode: InteractionMode,
  importTier: ImportTier,
): {
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
        "Describe an output, tool, or specialist you want to build. The authoring agent asks a few questions, then drafts a response schema, tool contract, or subagent definition with you. You can also paste any of the three to quality-check it.",
      hint: 'Say "just draft it" if you don\'t want any questions before the first draft.',
      placeholder: "e.g. A helper that reviews my invoices",
      button: "Send",
      busy: "Working…",
    };
  }
  if (mode === "import") {
    if (importTier === "related-primitives") {
      return {
        title: "Import",
        empty:
          "Choose the documents that belong together — a skill plus the tool contracts and output shapes it works with. Each one is checked on its own, so a document we can't read won't lose you the rest.",
        placeholder: "",
        button: "Import documents",
        busy: "Importing…",
      };
    }
    if (importTier === "agent-configuration") {
      return {
        title: "Import",
        empty:
          "Choose an archive of an existing agent setup. We'll show you every part we find — and remove any secret values before anything is stored. Nothing is saved until you say so.",
        placeholder: "",
        button: "Read archive",
        busy: "Reading…",
      };
    }
    return {
      title: "Import",
      empty:
        "Paste a skill, response schema, tool contract, or subagent definition — or a public GitHub URL. We'll work out which one it is.",
      placeholder: "https://github.com/acme/skills/tree/main/inbox\n\n---\nname: inbox-triage\ndescription: Sort unread email.\n---",
      button: "Import document",
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
