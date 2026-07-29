import type { SourceSnapshot } from "@/modules/agent-configuration-import";

export const SOURCE_SNAPSHOT_LIMITS = Object.freeze({
  maxFiles: 2_048,
  maxFileBytes: 1_048_576,
  maxTotalBytes: 16_777_216,
  maxArchiveBytes: 16_777_216,
  maxCompressionRatio: 100,
});

export class InvalidSourceSnapshot extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidSourceSnapshot";
  }
}

export type RepositoryImportEntry = {
  readonly path: string;
  readonly bytes: Uint8Array;
  readonly kind?: "file" | "symlink" | "submodule";
};

export function normalizeSourcePath(path: string): string {
  const normalized = path.replaceAll("\\", "/").normalize("NFC");
  if (
    normalized.length === 0
    || normalized.startsWith("/")
    || /^[A-Za-z]:\//.test(normalized)
    || normalized.includes("\0")
    || normalized.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new InvalidSourceSnapshot("Source entries must use normalized relative paths.");
  }
  return normalized;
}

/**
 * Repository import accepts already-read blobs only. It never clones, resolves
 * links, loads a worktree, or runs package/repository code.
 */
export function sourceSnapshotFromRepository(
  entries: readonly RepositoryImportEntry[],
): SourceSnapshot {
  if (entries.length > SOURCE_SNAPSHOT_LIMITS.maxFiles) {
    throw new InvalidSourceSnapshot("Source snapshot exceeds the file-count limit.");
  }

  let total = 0;
  const paths = new Map<string, string>();
  const files = entries.map((entry) => {
    if ((entry.kind ?? "file") !== "file") {
      throw new InvalidSourceSnapshot("Repository links and submodules are not importable.");
    }
    const path = normalizeSourcePath(entry.path);
    const collisionKey = path.toLocaleLowerCase("en-US");
    if (paths.has(collisionKey)) {
      throw new InvalidSourceSnapshot("Source snapshot contains an ambiguous path collision.");
    }
    paths.set(collisionKey, path);
    if (entry.bytes.byteLength > SOURCE_SNAPSHOT_LIMITS.maxFileBytes) {
      throw new InvalidSourceSnapshot("A source file exceeds the per-file size limit.");
    }
    total += entry.bytes.byteLength;
    if (total > SOURCE_SNAPSHOT_LIMITS.maxTotalBytes) {
      throw new InvalidSourceSnapshot("Source snapshot exceeds the total-byte limit.");
    }
    return { path, bytes: Uint8Array.from(entry.bytes) };
  });

  files.sort((a, b) => a.path.localeCompare(b.path));
  return { files };
}
