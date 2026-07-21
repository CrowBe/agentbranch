import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderInitialTapSnapshot, runInitialTapRelease } from "../../../scripts/initial-tap-release";

const tempDirs: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("initial tap release", () => {
  it("renders the reviewed seed file set", () => {
    const snapshot = renderInitialTapSnapshot();
    expect(snapshot.files[0]?.path).toBe(".claude-plugin/marketplace.json");
    expect(snapshot.files.filter((file) => file.path.endsWith("/SKILL.md"))).toHaveLength(20);
  });

  it("defaults to a dry run without changing the checkout", async () => {
    const repo = await temporaryRepo();
    const marker = path.join(repo, "skills", "keep.txt");
    await writeFile(marker, "keep");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await expect(runInitialTapRelease(["--repo", repo], {})).resolves.toBe("dry-run");
    await expect(readFile(marker, "utf8")).resolves.toBe("keep");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("applies only with --fire and defers dispatch when the token is missing", async () => {
    const repo = await temporaryRepo();
    await expect(runInitialTapRelease(["--repo", repo, "--fire"], {})).resolves.toBe("unavailable");
    await expect(access(path.join(repo, ".claude-plugin", "marketplace.json"))).resolves.toBeUndefined();
    await expect(access(path.join(repo, "skills", "agentbranch"))).resolves.toBeUndefined();
  });
});

async function temporaryRepo(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "agentbranch-tap-release-"));
  tempDirs.push(dir);
  await mkdir(path.join(dir, "skills"), { recursive: true });
  return dir;
}
