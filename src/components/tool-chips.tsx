import { Chip, type ChipAccent } from "./ui/chip";
import type { ToolAction } from "./workspace";

/**
 * Tool surfaces as chips on the hero header (ARCHITECTURE §7). Chip → tool
 * mapping and accents per DESIGN §5: Visualise/Run = primary, Triggers/Safety =
 * tertiary, Export = secondary. Safety is the manual, opt-in safety rating
 * (ARCHITECTURE §9.1): it scans only when the version is unrated — a rated
 * version re-opens its stored rating at no cost.
 */
const CHIPS: { id: ToolAction; label: string; accent: ChipAccent }[] = [
  { id: "visualise", label: "Visualise", accent: "primary" },
  { id: "test-run", label: "Run", accent: "primary" },
  { id: "triggering-eval", label: "Triggers", accent: "tertiary" },
  { id: "safety-review", label: "Safety", accent: "tertiary" },
  { id: "export", label: "Export", accent: "secondary" },
];

export function ToolChips({
  active,
  busy = false,
  onSelect,
}: {
  active?: ToolAction | null;
  busy?: boolean;
  onSelect?: (action: ToolAction) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {CHIPS.map((chip) => (
        <Chip
          key={chip.id}
          accent={chip.accent}
          disabled={busy}
          onClick={() => onSelect?.(chip.id)}
        >
          {active === chip.id && busy ? "Running..." : chip.label}
        </Chip>
      ))}
    </div>
  );
}
