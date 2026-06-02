import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "tertiary";

// DESIGN §5: Primary solid; Secondary ghost outline; Warning/constraint amber.
const VARIANT: Record<Variant, string> = {
  primary: "bg-primary text-on-primary hover:opacity-90",
  secondary: "border border-secondary text-secondary hover:bg-secondary/10",
  tertiary: "bg-tertiary text-on-tertiary hover:opacity-90",
};

export function Button({
  children,
  variant = "primary",
  className = "",
  ...rest
}: {
  children: ReactNode;
  variant?: Variant;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={`text-label rounded-[var(--radius-sm)] px-4 py-2 transition disabled:opacity-50 ${VARIANT[variant]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
