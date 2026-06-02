import { Chip, type ChipAccent } from "./ui/chip";

/**
 * Tool surfaces as chips on the hero header (ARCHITECTURE §7). Chip → tool
 * mapping and accents per DESIGN §5: Visualise/Run = primary, Triggers =
 * tertiary, Export = secondary.
 */
const CHIPS: { label: string; accent: ChipAccent }[] = [
  { label: "Visualise", accent: "primary" },
  { label: "Run", accent: "primary" },
  { label: "Triggers", accent: "tertiary" },
  { label: "Export", accent: "secondary" },
];

export function ToolChips() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {CHIPS.map((chip) => (
        <Chip key={chip.label} accent={chip.accent}>
          {chip.label}
        </Chip>
      ))}
    </div>
  );
}
