import type { HeroView } from "@/modules/hero";

/**
 * The hero view toggle — a small segmented control, Rendered | Source,
 * defaulting Rendered (DESIGN §5, ARCHITECTURE §7). Sentence-case labels.
 */
export function ViewToggle({
  value,
  onChange,
}: {
  value: HeroView;
  onChange: (view: HeroView) => void;
}) {
  return (
    <div className="inline-flex rounded-[var(--radius-md)] border border-outline-variant p-0.5">
      {(["rendered", "source"] as const).map((view) => (
        <button
          key={view}
          type="button"
          onClick={() => onChange(view)}
          className={`text-label rounded-[calc(var(--radius-md)-2px)] px-3 py-1 capitalize ${
            value === view ? "bg-primary text-on-primary" : "text-on-surface-variant"
          }`}
        >
          {view}
        </button>
      ))}
    </div>
  );
}
