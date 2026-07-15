"use client";

import { useState } from "react";
import { THEME_COOKIE, THEME_SETS, isThemeSetId } from "@/app/themes/registry";

/**
 * The theme-set picker (DESIGN §4) — lives in the expanded slideout's footer,
 * above Account. "System" (the default) follows prefers-color-scheme and
 * stores nothing; picking a theme set persists browser-level in the
 * ab-theme cookie, which the root layout's pre-paint script reads on the
 * next visit. Account-level sync is deferred until account UI exists.
 */
type ThemeChoice = "system" | string;

function readChoice(): ThemeChoice {
  if (typeof document === "undefined") return "system";
  const match = document.cookie.match(new RegExp(`(?:^|; )${THEME_COOKIE}=([^;]*)`));
  const value = match?.[1] ? decodeURIComponent(match[1]) : null;
  return value && isThemeSetId(value) ? value : "system";
}

function applyChoice(choice: ThemeChoice) {
  if (choice === "system") {
    document.cookie = `${THEME_COOKIE}=; path=/; max-age=0; samesite=lax`;
    const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  } else {
    document.cookie = `${THEME_COOKIE}=${encodeURIComponent(choice)}; path=/; max-age=31536000; samesite=lax`;
    document.documentElement.dataset.theme = choice;
  }
}

const CHOICES: readonly { value: ThemeChoice; label: string }[] = [
  { value: "system", label: "System" },
  ...THEME_SETS.map((theme) => ({ value: theme.id, label: theme.label })),
];

export function ThemePicker() {
  // Lazy init is safe: the picker mounts only inside the opened slideout,
  // which is always a client-side render (the shell ships collapsed).
  const [choice, setChoice] = useState<ThemeChoice>(readChoice);

  return (
    <div className="pb-2" role="radiogroup" aria-label="Theme">
      <p className="text-label px-2.5 pb-1 text-on-surface-variant">Theme</p>
      <ul className="flex flex-col gap-0.5">
        {CHOICES.map((option) => (
          <li key={option.value}>
            <button
              type="button"
              role="radio"
              aria-checked={choice === option.value}
              onClick={() => {
                applyChoice(option.value);
                setChoice(option.value);
              }}
              className={`flex w-full items-center rounded-[var(--radius-md)] px-2.5 py-1.5 text-left ${
                choice === option.value
                  ? "bg-primary/10 text-primary"
                  : "text-on-surface-variant hover:bg-surface-high"
              }`}
            >
              <span className="text-label">{option.label}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
