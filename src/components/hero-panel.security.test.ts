import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const heroPanelPath = join(process.cwd(), "src/components/hero-panel.tsx");

describe("hero render path security", () => {
  it("keeps rendered skill content on React-escaped JSX surfaces", () => {
    const source = readFileSync(heroPanelPath, "utf8");
    expect(source).not.toContain("dangerouslySetInnerHTML");
  });
});
