import type { ReactNode } from "react";

type Tone = "success" | "warn" | "error" | "neutral";

// State pills, radius-full (DESIGN §5).
const TONE: Record<Tone, string> = {
  success: "bg-secondary/15 text-secondary",
  warn: "bg-tertiary/15 text-tertiary",
  error: "bg-error/15 text-error",
  neutral: "bg-surface-high text-on-surface-variant",
};

export function Pill({ children, tone = "neutral" }: { children: ReactNode; tone?: Tone }) {
  return (
    <span
      className={`text-label inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 ${TONE[tone]}`}
    >
      {children}
    </span>
  );
}
