import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    // The visual suite needs a real browser — vitest.visual.config.ts owns it.
    exclude: ["**/node_modules/**", "src/**/*.visual.test.tsx"],
    coverage: {
      provider: "v8",
      include: ["src/modules/**/*.ts"],
    },
  },
});
