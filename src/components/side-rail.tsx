"use client";

import { useState } from "react";
import { ThemePicker } from "./theme-picker";

/**
 * Left nav — a 56px icon bar that never leaves the flow; its expansion is a
 * 240px labelled slideout *overlaying* the content (ARCHITECTURE §7), so the
 * main window keeps its width at every viewport. Opens on hover where a fine
 * pointer exists, and from the top-bar hamburger everywhere; on compact
 * viewports the slideout floats over a scrim and closes on scrim tap or after
 * a pick.
 */
const NAV = [
  { key: "build", label: "Build", icon: "✶" },
  { key: "import", label: "Import", icon: "⇪" },
  { key: "skills", label: "My skills", icon: "▤" },
  { key: "equipment", label: "Equipment", icon: "⚒" },
  { key: "history", label: "History", icon: "↻" },
  { key: "templates", label: "Templates", icon: "◳" },
  { key: "models", label: "Models", icon: "◈" },
] as const;

export type SideRailView = (typeof NAV)[number]["key"];

export function SideRail({
  expanded,
  active = "build",
  onCollapse,
  onBuild,
  onImport,
  onSkills,
  onEquipment,
  onHistory,
  onTemplates,
  onModels,
  onAccount,
}: {
  expanded: boolean;
  active?: SideRailView;
  /** Close request from the scrim or a nav pick (compact viewports). */
  onCollapse?: () => void;
  onBuild?: () => void;
  onImport?: () => void;
  onSkills?: () => void;
  onEquipment?: () => void;
  onHistory?: () => void;
  onTemplates?: () => void;
  onModels?: () => void;
  onAccount?: () => void;
}) {
  const [hoverOpen, setHoverOpen] = useState(false);
  const open = expanded || hoverOpen;

  const handlers = { onBuild, onImport, onSkills, onEquipment, onHistory, onTemplates, onModels };

  return (
    <div
      className="relative shrink-0"
      style={{ width: "var(--spacing-rail)" }}
      onMouseEnter={() => {
        // Pop out on hover only where a real hover exists (not touch).
        if (typeof window.matchMedia === "function" && window.matchMedia("(hover: hover)").matches) {
          setHoverOpen(true);
        }
      }}
      onMouseLeave={() => setHoverOpen(false)}
    >
      {expanded && (
        <div
          className="fixed inset-0 z-30 bg-scrim/40 lg:hidden"
          aria-hidden
          onClick={onCollapse}
        />
      )}
      <nav
        className={`flex h-full flex-col justify-between gap-4 overflow-y-auto border-r border-outline-variant bg-surface py-3 transition-[width] duration-200 ${
          open
            ? "elevation-overlay absolute inset-y-0 left-0 z-40"
            : "w-full"
        }`}
        style={open ? { width: "var(--spacing-menu)" } : undefined}
      >
        <ul className="flex flex-col gap-1 px-2">
          {NAV.map((item) => (
            <li key={item.key}>
              <button
                type="button"
                aria-label={open ? undefined : item.label}
                onClick={() => {
                  handlerFor(item.key, handlers)?.();
                  onCollapse?.();
                }}
                className={`flex w-full items-center gap-3 rounded-[var(--radius-md)] px-2.5 py-2 text-left ${
                  item.key === active
                    ? "bg-primary/10 text-primary"
                    : "text-on-surface-variant hover:bg-surface-high"
                }`}
              >
                <span className="w-5 shrink-0 text-center" aria-hidden>
                  {item.icon}
                </span>
                {open && <span className="text-label">{item.label}</span>}
              </button>
            </li>
          ))}
        </ul>

        <div className="px-2">
          {open && <ThemePicker />}
          <button
            type="button"
            aria-label={open ? undefined : "Account"}
            onClick={() => {
              onAccount?.();
              onCollapse?.();
            }}
            className="flex w-full items-center gap-3 rounded-[var(--radius-md)] px-2.5 py-2 text-on-surface-variant hover:bg-surface-high"
          >
            <span className="text-label flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface-high">
              D
            </span>
            {open && <span className="text-label">Account</span>}
          </button>
        </div>
      </nav>
    </div>
  );
}

function handlerFor(
  key: SideRailView,
  handlers: {
    readonly onBuild?: () => void;
    readonly onImport?: () => void;
    readonly onSkills?: () => void;
    readonly onEquipment?: () => void;
    readonly onHistory?: () => void;
    readonly onTemplates?: () => void;
    readonly onModels?: () => void;
  },
) {
  if (key === "build") return handlers.onBuild;
  if (key === "import") return handlers.onImport;
  if (key === "skills") return handlers.onSkills;
  if (key === "equipment") return handlers.onEquipment;
  if (key === "history") return handlers.onHistory;
  if (key === "templates") return handlers.onTemplates;
  if (key === "models") return handlers.onModels;
  return undefined;
}
