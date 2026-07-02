import type {
  HarnessManifest,
  HarnessVersion,
  HarnessVersionRepository,
} from "@/modules/harness-version";
import { hashHarnessManifest } from "@/modules/harness-version";
import { HarnessVersionId, ok } from "@/shared";

/** In-memory HarnessVersionRepository — the offline default. */
export function createMemoryHarnessVersionRepository(): HarnessVersionRepository {
  const versions = new Map<string, HarnessVersion>();

  return {
    async current(manifest: HarnessManifest) {
      const manifestHash = hashHarnessManifest(manifest);
      const existing = versions.get(manifestHash);
      if (existing) return ok(existing);

      const version: HarnessVersion = {
        id: HarnessVersionId(crypto.randomUUID()),
        manifestHash,
        ...manifest,
        createdAt: new Date(),
      };
      versions.set(manifestHash, version);
      return ok(version);
    },
  };
}
