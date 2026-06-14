/**
 * Left slideout menu — all primary nav + account footer (ARCHITECTURE §7).
 * Collapsed to a 56px icon rail by default for max hero width; expands to a
 * 240px labelled slideout on demand (DESIGN §3.4).
 */
const NAV = [
  { key: "build", label: "Build", icon: "✶", active: true },
  { key: "import", label: "Import", icon: "⇪", active: false },
  { key: "skills", label: "My skills", icon: "▤", active: false },
  { key: "history", label: "History", icon: "↻", active: false },
  { key: "templates", label: "Templates", icon: "◳", active: false },
  { key: "models", label: "Models", icon: "◈", active: false },
] as const;

export function SideRail({
  expanded,
  onImport,
  onModels,
}: {
  expanded: boolean;
  onImport?: () => void;
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
              onClick={
                item.key === "import" ? onImport : item.key === "models" ? onModels : undefined
              }
              className={`flex w-full items-center gap-3 rounded-[var(--radius-md)] px-2.5 py-2 text-left ${
                item.active
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
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface-high text-[10px]">
            D
          </span>
          {expanded && <span className="text-label">Account</span>}
        </button>
      </div>
    </nav>
  );
}
