import { gunzipSync, inflateRawSync } from "node:zlib";
import type { SourceSnapshot } from "@/modules/agent-configuration-import";
import {
  InvalidSourceSnapshot,
  SOURCE_SNAPSHOT_LIMITS,
  sourceSnapshotFromRepository,
  type RepositoryImportEntry,
} from "./source-snapshot";

export type LocalArchiveFormat = "zip" | "tar" | "tar.gz";

function unsigned16(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}

function unsigned32(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset]!
    | (bytes[offset + 1]! << 8)
    | (bytes[offset + 2]! << 16)
    | (bytes[offset + 3]! << 24)
  ) >>> 0;
}

function signature(bytes: Uint8Array, offset: number, value: number): boolean {
  return offset >= 0 && offset + 4 <= bytes.length && unsigned32(bytes, offset) === value;
}

function decodePath(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new InvalidSourceSnapshot("Archive entry paths must be UTF-8.");
  }
}

function rejectArchiveSize(bytes: Uint8Array): void {
  if (bytes.byteLength > SOURCE_SNAPSHOT_LIMITS.maxArchiveBytes) {
    throw new InvalidSourceSnapshot("Archive exceeds the compressed-byte limit.");
  }
}

function zipEntries(archive: Uint8Array): RepositoryImportEntry[] {
  let eocd = -1;
  const minimum = Math.max(0, archive.length - 65_557);
  for (let offset = archive.length - 22; offset >= minimum; offset -= 1) {
    if (signature(archive, offset, 0x06054b50)) {
      eocd = offset;
      break;
    }
  }
  if (eocd === -1) throw new InvalidSourceSnapshot("ZIP end record is missing.");
  if (unsigned16(archive, eocd + 4) !== 0 || unsigned16(archive, eocd + 6) !== 0) {
    throw new InvalidSourceSnapshot("Multi-disk ZIP archives are not supported.");
  }
  const count = unsigned16(archive, eocd + 10);
  const directorySize = unsigned32(archive, eocd + 12);
  const directoryOffset = unsigned32(archive, eocd + 16);
  if (
    count > SOURCE_SNAPSHOT_LIMITS.maxFiles
    || directoryOffset + directorySize > eocd
  ) {
    throw new InvalidSourceSnapshot("ZIP directory violates resource limits.");
  }

  let cursor = directoryOffset;
  let declaredTotal = 0;
  const entries: RepositoryImportEntry[] = [];
  for (let index = 0; index < count; index += 1) {
    if (!signature(archive, cursor, 0x02014b50) || cursor + 46 > archive.length) {
      throw new InvalidSourceSnapshot("ZIP directory is malformed.");
    }
    const flags = unsigned16(archive, cursor + 8);
    const method = unsigned16(archive, cursor + 10);
    const compressedSize = unsigned32(archive, cursor + 20);
    const size = unsigned32(archive, cursor + 24);
    const nameLength = unsigned16(archive, cursor + 28);
    const extraLength = unsigned16(archive, cursor + 30);
    const commentLength = unsigned16(archive, cursor + 32);
    const externalAttributes = unsigned32(archive, cursor + 38);
    const localOffset = unsigned32(archive, cursor + 42);
    const end = cursor + 46 + nameLength + extraLength + commentLength;
    if (end > archive.length) throw new InvalidSourceSnapshot("ZIP directory entry is truncated.");
    const path = decodePath(archive.slice(cursor + 46, cursor + 46 + nameLength));
    cursor = end;

    if (path.endsWith("/")) continue;
    if ((flags & 0x1) !== 0) throw new InvalidSourceSnapshot("Encrypted ZIP entries are not importable.");
    if (method !== 0 && method !== 8) throw new InvalidSourceSnapshot("ZIP compression method is unsupported.");
    const unixMode = externalAttributes >>> 16;
    if ((unixMode & 0o170000) === 0o120000) {
      throw new InvalidSourceSnapshot("Archive links are not importable.");
    }
    if (
      size > SOURCE_SNAPSHOT_LIMITS.maxFileBytes
      || (compressedSize === 0 ? size > 0 : size / compressedSize > SOURCE_SNAPSHOT_LIMITS.maxCompressionRatio)
    ) {
      throw new InvalidSourceSnapshot("ZIP entry violates decompression limits.");
    }
    declaredTotal += size;
    if (declaredTotal > SOURCE_SNAPSHOT_LIMITS.maxTotalBytes) {
      throw new InvalidSourceSnapshot("ZIP archive exceeds the expanded-byte limit.");
    }

    if (!signature(archive, localOffset, 0x04034b50) || localOffset + 30 > archive.length) {
      throw new InvalidSourceSnapshot("ZIP local entry is malformed.");
    }
    const localNameLength = unsigned16(archive, localOffset + 26);
    const localExtraLength = unsigned16(archive, localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    if (dataOffset + compressedSize > archive.length) {
      throw new InvalidSourceSnapshot("ZIP entry data is truncated.");
    }
    const compressed = archive.slice(dataOffset, dataOffset + compressedSize);
    let bytes: Uint8Array;
    try {
      bytes = method === 0
        ? Uint8Array.from(compressed)
        : Uint8Array.from(inflateRawSync(compressed, { maxOutputLength: size + 1 }));
    } catch {
      throw new InvalidSourceSnapshot("ZIP entry could not be decompressed within limits.");
    }
    if (bytes.byteLength !== size) throw new InvalidSourceSnapshot("ZIP entry size is inconsistent.");
    entries.push({ path, bytes });
  }
  return entries;
}

function tarString(bytes: Uint8Array): string {
  const end = bytes.indexOf(0);
  return decodePath(end === -1 ? bytes : bytes.slice(0, end));
}

function tarSize(bytes: Uint8Array): number {
  const raw = tarString(bytes).trim();
  if (!/^[0-7]*$/.test(raw)) throw new InvalidSourceSnapshot("TAR entry size is malformed.");
  return raw.length === 0 ? 0 : Number.parseInt(raw, 8);
}

function tarEntries(archive: Uint8Array): RepositoryImportEntry[] {
  const entries: RepositoryImportEntry[] = [];
  let cursor = 0;
  while (cursor + 512 <= archive.length) {
    const header = archive.slice(cursor, cursor + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = tarString(header.slice(0, 100));
    const prefix = tarString(header.slice(345, 500));
    const path = prefix ? `${prefix}/${name}` : name;
    const size = tarSize(header.slice(124, 136));
    const kind = String.fromCharCode(header[156] ?? 0);
    const dataOffset = cursor + 512;
    const next = dataOffset + Math.ceil(size / 512) * 512;
    if (next > archive.length) throw new InvalidSourceSnapshot("TAR entry data is truncated.");
    if (kind === "5") {
      cursor = next;
      continue;
    }
    if (kind !== "\0" && kind !== "0") {
      throw new InvalidSourceSnapshot("TAR links and special entries are not importable.");
    }
    if (size > SOURCE_SNAPSHOT_LIMITS.maxFileBytes) {
      throw new InvalidSourceSnapshot("TAR entry exceeds the per-file size limit.");
    }
    entries.push({ path, bytes: archive.slice(dataOffset, dataOffset + size) });
    if (entries.length > SOURCE_SNAPSHOT_LIMITS.maxFiles) {
      throw new InvalidSourceSnapshot("TAR archive exceeds the file-count limit.");
    }
    cursor = next;
  }
  return entries;
}

/**
 * Parses local archive bytes in memory. No entry is written or executed.
 */
export function sourceSnapshotFromArchive(
  input: Uint8Array,
  format: LocalArchiveFormat,
): SourceSnapshot {
  rejectArchiveSize(input);
  let archive = Uint8Array.from(input);
  if (format === "tar.gz") {
    try {
      archive = Uint8Array.from(gunzipSync(archive, {
        maxOutputLength: SOURCE_SNAPSHOT_LIMITS.maxTotalBytes + 512,
      }));
    } catch {
      throw new InvalidSourceSnapshot("Gzip archive could not be expanded within limits.");
    }
    if (
      input.byteLength > 0
      && archive.byteLength / input.byteLength > SOURCE_SNAPSHOT_LIMITS.maxCompressionRatio
    ) {
      throw new InvalidSourceSnapshot("Gzip archive exceeds the compression-ratio limit.");
    }
  }
  return sourceSnapshotFromRepository(
    format === "zip" ? zipEntries(archive) : tarEntries(archive),
  );
}
