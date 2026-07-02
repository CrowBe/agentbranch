import { describe, expect, it } from "vitest";
import { currentHarnessManifest } from "@/modules/harness-version";
import { unwrap } from "@/shared";
import { createMemoryHarnessVersionRepository } from "./harness-version.memory-repository";

describe("harness version memory adapter", () => {
  it("reuses the current version until an artifact hash changes", async () => {
    const repo = createMemoryHarnessVersionRepository();
    const manifest = currentHarnessManifest();

    const first = unwrap(await repo.current(manifest));
    const second = unwrap(await repo.current(manifest));
    const changed = unwrap(
      await repo.current({
        ...manifest,
        lintRuleset: `${manifest.lintRuleset}-changed`,
      }),
    );

    expect(second.id).toBe(first.id);
    expect(second.manifestHash).toBe(first.manifestHash);
    expect(changed.id).not.toBe(first.id);
    expect(changed.manifestHash).not.toBe(first.manifestHash);
  });
});
