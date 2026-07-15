/**
 * The theme-set registry (DESIGN.md §4) — the one list every theme surface
 * reads: the pre-paint resolver in layout.tsx, the theme picker, and the
 * design-conformance guard. A theme set ships as a `[data-theme="<id>"]`
 * block (system themes in globals.css, custom sets as their own file in this
 * folder) plus a palette table in DESIGN.md §4.
 */
export interface ThemeSet {
  /** The `data-theme` value and cookie value. */
  readonly id: string;
  /** Sentence-case picker label. */
  readonly label: string;
  /** Which `color-scheme` the palette is (native controls, scrollbars). */
  readonly scheme: "light" | "dark";
  /**
   * `system` themes are the prefers-color-scheme pair — AA contrast
   * guaranteed, look tokens never overridden. `custom` sets are opt-in
   * full-look skins: contrast is best-effort and the look tokens
   * (type families, radius, overlay shadow) may swap.
   */
  readonly kind: "system" | "custom";
}

export const THEME_SETS: readonly ThemeSet[] = [
  { id: "light", label: "Light", scheme: "light", kind: "system" },
  { id: "dark", label: "Dark", scheme: "dark", kind: "system" },
  { id: "tuxedo", label: "Tuxedo", scheme: "dark", kind: "custom" },
];

/** Browser-level persistence: the selected theme-set id, or absent = system. */
export const THEME_COOKIE = "ab-theme";

export function isThemeSetId(value: string): boolean {
  return THEME_SETS.some((theme) => theme.id === value);
}
