/**
 * Visual-suite setup: the real token layer + pinned fonts + determinism.
 *
 * Fonts come from @fontsource (the same families next/font loads in the app)
 * so text renders identically on every machine; the next/font CSS variables
 * are pointed at them below. Transitions, animations, and carets are disabled
 * so screenshots never race motion.
 */
import "@fontsource/hanken-grotesk/600.css";
import "@fontsource/hanken-grotesk/700.css";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "@/app/globals.css";
import { beforeEach } from "vitest";

const style = document.createElement("style");
style.textContent = `
  :root {
    --font-hanken: "Hanken Grotesk";
    --font-inter: "Inter";
    --font-jetbrains: "JetBrains Mono";
  }
  *, *::before, *::after {
    transition: none !important;
    animation: none !important;
    caret-color: transparent !important;
  }
`;
document.head.append(style);

beforeEach(async () => {
  // Reset to the default theme; dark-theme tests opt in per test.
  document.documentElement.dataset.theme = "light";
  await document.fonts.ready;
});
