import type { ReactNode } from "react";

/**
 * Segmented control — the one two-way switch treatment (DESIGN §5): outlined
 * radius-md container, tinted primary active segment (the chips' accent
 * language), sentence-case labels. Used by the hero's Rendered | Source toggle
 * and the Insights | Breakdown surface tabs.
 */
export function Segmented<T extends string>({
  options,
  value,
  disabled = false,
  onChange,
}: {
  options: readonly { value: T; label: ReactNode }[];
  value: T;
  disabled?: boolean;
  onChange: (value: T) => void;
}) {
  return (
    <div className="inline-flex w-fit rounded-[var(--radius-md)] border border-outline-variant p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          disabled={disabled}
          onClick={() => {
            if (option.value !== value) onChange(option.value);
          }}
          className={`text-label rounded-[calc(var(--radius-md)-2px)] px-3 py-1.5 transition-colors ${
            option.value === value
              ? "bg-primary/15 text-primary"
              : "text-on-surface-variant hover:bg-surface-high"
          } disabled:cursor-not-allowed disabled:opacity-60`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
