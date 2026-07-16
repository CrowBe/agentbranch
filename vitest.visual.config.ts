import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { playwright } from "@vitest/browser-playwright";
import { fileURLToPath } from "node:url";

/**
 * The visual suite (DESIGN.md §5.3) — real Chromium screenshots of the design
 * system's components in both themes, compared against committed baselines.
 * Separate from vitest.config.ts because it needs a browser: run with
 * `npm run test:visual`, refresh baselines with `npm run test:visual:update`.
 *
 * CHROMIUM_EXECUTABLE overrides browser resolution for environments with a
 * pre-provisioned Chromium (e.g. a remote agent environment); everywhere else the
 * installed playwright package resolves its own browser.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    name: "visual",
    include: ["src/**/*.visual.test.tsx"],
    setupFiles: ["./vitest.visual.setup.ts"],
    browser: {
      enabled: true,
      headless: true,
      screenshotFailures: false,
      provider: playwright({
        launchOptions: process.env.CHROMIUM_EXECUTABLE
          ? { executablePath: process.env.CHROMIUM_EXECUTABLE }
          : {},
      }),
      viewport: { width: 1024, height: 768 },
      instances: [{ browser: "chromium" }],
      expect: {
        toMatchScreenshot: {
          comparatorName: "pixelmatch",
          comparatorOptions: {
            // Absorb antialiasing drift across machines without letting a
            // token regression (a color, a size, a missing scrim) through.
            allowedMismatchedPixelRatio: 0.01,
          },
        },
      },
    },
  },
});
