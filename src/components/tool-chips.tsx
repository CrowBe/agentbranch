import { Chip, type ChipAccent } from "./ui/chip";

export type ToolAction = "visualise" | "test-run" | "triggering-eval" | "export";

/**
 * Tool surfaces as chips on the hero header (ARCHITECTURE §7). Chip → tool
 * mapping and accents per DESIGN §5: Visualise/Run = primary, Triggers =
 * tertiary, Export = secondary.
 */
const CHIPS: { id: ToolAction; label: string; accent: ChipAccent }[] = [
  { id: "visualise", label: "Visualise", accent: "primary" },
  { id: "test-run", label: "Run", accent: "primary" },
  { id: "triggering-eval", label: "Triggers", accent: "tertiary" },
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
