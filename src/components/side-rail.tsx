/**
 * Left slideout menu — all primary nav + account footer (ARCHITECTURE §7).
 * Collapsed to a 56px icon rail by default for max hero width; expands to a
 * 240px labelled slideout on demand (DESIGN §3.4).
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
  onBuild,
  onImport,
  onSkills,
  onEquipment,
  onHistory,
  onTemplates,
  onModels,
}: {
  expanded: boolean;
  active?: SideRailView;
  onBuild?: () => void;
  onImport?: () => void;
  onSkills?: () => void;
  onEquipment?: () => void;
  onHistory?: () => void;
  onTemplates?: () => void;
  onModels?: () => void;
}) {
  return (
    <nav
      className="flex shrink-0 flex-col justify-between border-r border-outline-variant bg-surface py-3 transition-[width] duration-200"
      style={{ width: expanded ? "var(--spacing-menu)" : "var(--spacing-rail)" }}
    >
      <ul className="flex flex-col gap-1 px-2">
        {NAV.map((item) => (
          <li key={item.key}>
            <button
              type="button"
              aria-label={expanded ? undefined : item.label}
              onClick={handlerFor(item.key, {
                onBuild,
                onImport,
                onSkills,
                onEquipment,
                onHistory,
                onTemplates,
                onModels,
              })}
              className={`flex w-full items-center gap-3 rounded-[var(--radius-md)] px-2.5 py-2 text-left ${
                item.key === active
                  ? "bg-primary/10 text-primary"
                  : "text-on-surface-variant hover:bg-surface-high"
              }`}
            >
              <span className="w-5 shrink-0 text-center" aria-hidden>
                {item.icon}
              </span>
              {expanded && <span className="text-label">{item.label}</span>}
            </button>
          </li>
        ))}
      </ul>

      <div className="px-2">
        <button
          type="button"
          aria-label={expanded ? undefined : "Account"}
          className="flex w-full items-center gap-3 rounded-[var(--radius-md)] px-2.5 py-2 text-on-surface-variant hover:bg-surface-high"
        >
          <span className="text-label flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface-high">
            D
          </span>
          {expanded && <span className="text-label">Account</span>}
        </button>
      </div>
    </nav>
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
