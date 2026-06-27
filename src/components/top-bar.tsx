import { Pill } from "./ui/pill";

/**
 * Thin branded top bar — chrome only, no nav links (ARCHITECTURE §7, DESIGN
 * §3.4 topbar-height 48px). Hamburger + mark + free-tier status chip.
 */
export function TopBar({ onToggleMenu }: { onToggleMenu: () => void }) {
  return (
    <header
      className="flex items-center justify-between border-b border-outline-variant bg-surface px-4"
      style={{ height: "var(--spacing-topbar)" }}
    >
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onToggleMenu}
          aria-label="Toggle menu"
          className="rounded-[var(--radius-sm)] p-1.5 text-on-surface-variant hover:bg-surface-high"
        >
          <MenuIcon />
        </button>
        <span className="text-headline-md select-none">agent.branch</span>
      </div>
      <Pill tone="success">Free plan</Pill>
    </header>
  );
}

function MenuIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
      <path d="M2 4.5h14M2 9h14M2 13.5h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
