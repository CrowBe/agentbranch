import { chmod, mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveChromiumExecutable } from "../.agents/skills/e2e-sitemap/browser-executable.mjs";

describe("resolveChromiumExecutable", () => {
  it("prefers an executable CHROMIUM_PATH override", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentbranch-browser-"));
    const override = join(root, "custom-chrome");
    await writeFile(override, "");
    await chmod(override, 0o755);

    await expect(
      resolveChromiumExecutable({ override, cacheRoot: root, systemCandidates: [] }),
    ).resolves.toMatchObject({ executablePath: override });
  });

  it("discovers Chromium in the Playwright cache", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentbranch-browser-"));
    const executable = join(root, "chromium-123", "chrome-linux", "chrome");
    await mkdir(join(root, "chromium-123", "chrome-linux"), { recursive: true });
    await writeFile(executable, "");
    await chmod(executable, 0o755);

    await expect(
      resolveChromiumExecutable({ override: "", cacheRoot: root, systemCandidates: [] }),
    ).resolves.toMatchObject({ executablePath: executable });
  });

  it("reports every checked path when discovery fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentbranch-browser-"));

    await expect(
      resolveChromiumExecutable({
        override: "/missing/override",
        cacheRoot: root,
        systemCandidates: ["/missing/system"],
      }),
    ).rejects.toThrow(
      "Paths checked:\n  - /missing/override\n  - /missing/system",
    );
  });
});
