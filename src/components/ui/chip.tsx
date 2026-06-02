import type { ReactNode } from "react";

/** Accent families a chip can take (DESIGN §5). */
export type ChipAccent = "primary" | "secondary" | "tertiary";

// ~15% accent fill + solid accent text. Authored with explicit classes so the
// Tailwind v4 scanner keeps them.
const ACCENT: Record<ChipAccent, string> = {
  primary: "bg-primary/15 text-primary",
  secondary: "bg-secondary/15 text-secondary",
  tertiary: "bg-tertiary/15 text-tertiary",
};

/** Tool-surface chip — radius-md, sentence-case label (DESIGN §5). */
export function Chip({
  children,
  accent = "primary",
  onClick,
}: {
  children: ReactNode;
  accent?: ChipAccent;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-label inline-flex items-center gap-1.5 rounded-[var(--radius-md)] px-3 py-1.5 transition-opacity hover:opacity-80 ${ACCENT[accent]}`}
    >
      {children}
    </button>
  );
}
