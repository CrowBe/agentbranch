import { readFile, readdir } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  createAgentConfigurationImportPreviewAnalyzer,
  createAgentConfigurationImportPreviewCapability,
  type AgentConfigurationImportPreview,
} from "@/modules/agent-configuration-import";
import { runCapability } from "@/modules/skill-analysis";
import { unwrap } from "@/shared";
import {
  InvalidSourceSnapshot,
  SOURCE_SNAPSHOT_LIMITS,
  sourceSnapshotFromArchive,
  sourceSnapshotFromRepository,
} from "./index";
import { defaultAgentConfigurationImportAdapters } from "./runtime-adapters";

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures");
const capability = createAgentConfigurationImportPreviewCapability(
  defaultAgentConfigurationImportAdapters,
);

async function fixture(name: string) {
  const root = resolve(FIXTURES, name);
  const entries: { path: string; bytes: Uint8Array }[] = [];
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else entries.push({
        path: relative(root, path).replaceAll("\\", "/"),
        bytes: await readFile(path),
      });
    }
  }
  await visit(root);
  return sourceSnapshotFromRepository(entries);
}

async function preview(name: string): Promise<AgentConfigurationImportPreview> {
  return unwrap(await runCapability(capability, "preview", await fixture(name)));
}

describe("agent configuration runtime adapters", () => {
  it.each([
    ["claude", "claude-code", ["hook", "instruction", "model", "policy", "skill", "subagent"]],
    ["codex", "codex", ["instruction", "model", "policy", "tool"]],
    ["openclaw", "openclaw", ["hook", "model", "policy", "skill", "subagent", "tool"]],
    ["agents", "agents", ["reference", "skill", "subagent", "tool"]],
  ] as const)("imports the %s fixture into typed components", async (name, runtime, kinds) => {
    const result = await preview(name);
    expect(result.runtimes.map((item) => item.runtime)).toEqual([runtime]);
    expect([...new Set(result.snapshot.components.map((item) => item.kind))].sort()).toEqual(kinds);
    expect(result.snapshot.components.every((item) => item.span && item.path)).toBe(true);
    expect(result.runtimes[0]?.adapter).toMatchObject({ version: "1" });
  });

  it("reports polyglot layouts and source-backed ambiguity without guessing it away", async () => {
    const claude = await fixture("claude");
    const agents = await fixture("agents");
    const result = unwrap(await runCapability(capability, "preview", sourceSnapshotFromRepository([
      ...claude.files,
      ...agents.files,
      { path: "AGENTS.md", bytes: new TextEncoder().encode("Shared instructions.") },
    ])));
    expect(result.runtimes.map((item) => item.runtime)).toEqual(["agents", "claude-code", "codex"]);
    expect(result.collisions).toContainEqual(expect.objectContaining({
      path: "AGENTS.md",
      componentKind: "instruction",
      runtimes: ["agents", "codex"],
    }));
    expect(result.collisions[0]?.evidence.every((item) => item.path === "AGENTS.md")).toBe(true);
  });

  it("preserves unsupported text, withholds opaque bytes, and produces stable repeated previews", async () => {
    const snapshot = sourceSnapshotFromRepository([
      { path: "AGENTS.md", bytes: new TextEncoder().encode("Instructions.") },
      { path: "vendor/unknown.cfg", bytes: new TextEncoder().encode("opaque=true\n") },
      { path: "vendor/blob.bin", bytes: Uint8Array.from([0xff, 0, 1]) },
    ]);
    const first = unwrap(await runCapability(capability, "preview", snapshot));
    const second = unwrap(await runCapability(capability, "preview", snapshot));
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.sourceFiles.filter((file) => file.classification === "unclassified").map((file) => file.path))
      .toEqual(["vendor/blob.bin", "vendor/unknown.cfg"]);
    expect(first.snapshot.files.find((file) => file.path === "vendor/unknown.cfg")?.content)
      .toBe("opaque=true\n");
    expect(first.snapshot.files.find((file) => file.path === "vendor/blob.bin"))
      .toMatchObject({ encoding: "base64", content: "" });
    expect(first.sourceFiles.find((file) => file.path === "vendor/blob.bin"))
      .toMatchObject({ byteLength: 3, sourceContentHash: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(first.warnings).toContainEqual(expect.objectContaining({
      code: "opaque-content-withheld",
      evidence: expect.objectContaining({ path: "vendor/blob.bin" }),
    }));
  });

  it("redacts secret values before preview and retains named requirements with evidence", async () => {
    const source = await fixture("claude");
    const result = unwrap(await runCapability(capability, "preview", sourceSnapshotFromRepository([
      ...source.files,
      {
        path: ".claude/extra.env",
        bytes: new TextEncoder().encode("TOKEN=plain-token\nUPSTREAM=${SERVICE_TOKEN}\n"),
      },
    ])));
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("claude secret value");
    expect(serialized).not.toContain("plain-token");
    expect(serialized).toContain("<redacted>");
    expect(result.snapshot.secretRequirements).toContainEqual({
      name: "API_KEY",
      purpose: "Imported apiKey setting",
    });
    expect(result.redactions).toContainEqual(expect.objectContaining({
      name: "API_KEY",
      evidence: expect.objectContaining({ path: ".claude/settings.json" }),
    }));
    expect(result.snapshot.secretRequirements.map((item) => item.name)).toEqual([
      "API_KEY",
      "SERVICE_TOKEN",
      "TOKEN",
    ]);
  });

  it("keeps connection credentials, authorization values, and private keys out of serialized previews", async () => {
    const databaseUrl = "postgresql://agent:database-password@db.example.test/agentbranch";
    const bearerToken = "header.payload.signature";
    const basicCredential = "dXNlcjpwYXNzd29yZA==";
    const neutralConnectionUrl = "redis://cache-user:cache-password@cache.example.test:6379";
    const privateKey = [
      "-----BEGIN PRIVATE KEY-----",
      "c3VwZXItc2VjcmV0LWtleQ==",
      "-----END PRIVATE KEY-----",
    ].join("\n");
    const result = unwrap(await runCapability(capability, "preview", sourceSnapshotFromRepository([
      { path: "AGENTS.md", bytes: new TextEncoder().encode("Instructions.") },
      {
        path: ".agents/mcp.json",
        bytes: new TextEncoder().encode(JSON.stringify({
          databaseUrl,
          headers: {
            Authorization: `Bearer ${bearerToken}`,
            "Proxy-Authorization": `Basic ${basicCredential}`,
          },
          tls: { privateKey },
          endpoint: neutralConnectionUrl,
        }, null, 2)),
      },
      {
        path: ".agents/settings.yaml",
        bytes: new TextEncoder().encode([
          `DATABASE_URL: ${databaseUrl}`,
          `authorization: "Bearer ${bearerToken}"`,
          `proxy_authorization: Bearer ${bearerToken}`,
          `signing_material: |`,
          ...privateKey.split("\n").map((line) => `  ${line}`),
        ].join("\n")),
      },
    ])));

    const serialized = JSON.stringify(result);
    for (const secret of [
      databaseUrl,
      "database-password",
      bearerToken,
      basicCredential,
      neutralConnectionUrl,
      "cache-password",
      privateKey,
      "c3VwZXItc2VjcmV0LWtleQ==",
    ]) {
      expect(serialized).not.toContain(secret);
    }
    expect(serialized).toContain("<redacted>");
    expect(result.snapshot.secretRequirements.map((item) => item.name)).toEqual(
      expect.arrayContaining(["AUTHORIZATION", "DATABASE_URL", "PRIVATE_KEY", "PROXY_AUTHORIZATION"]),
    );
  });

  it("keeps opaque bytes in the import artifact but withholds them from the rendered preview", async () => {
    const bytes = Uint8Array.from([0xff, 0, 1, 2]);
    const snapshot = sourceSnapshotFromRepository([
      { path: "AGENTS.md", bytes: new TextEncoder().encode("Instructions.") },
      { path: "vendor/blob.bin", bytes },
    ]);
    const analyzer = createAgentConfigurationImportPreviewAnalyzer(
      defaultAgentConfigurationImportAdapters,
    );
    const artifact = unwrap(await analyzer.analyze(snapshot));
    const rendered = unwrap(await runCapability(capability, "preview", snapshot));

    expect(artifact.snapshot.files.find((file) => file.path === "vendor/blob.bin"))
      .toMatchObject({ encoding: "base64", content: "/wABAg==" });
    expect(rendered.snapshot.files.find((file) => file.path === "vendor/blob.bin"))
      .toMatchObject({ encoding: "base64", content: "" });
    expect(JSON.stringify(rendered)).not.toContain("/wABAg==");
  });

  it("links every component, warning, and runtime detection to exact path/span evidence", async () => {
    const snapshot = sourceSnapshotFromRepository([
      { path: ".claude/settings.json", bytes: Uint8Array.from([0xff]) },
      { path: "CLAUDE.md", bytes: new TextEncoder().encode("Line one\nLine two\n") },
    ]);
    const result = unwrap(await runCapability(capability, "preview", snapshot));
    expect(result.snapshot.components.every((item) =>
      item.span
      && item.span.startLine >= 1
      && result.snapshot.files.some((file) => file.path === item.path),
    )).toBe(true);
    expect(result.warnings).toContainEqual(expect.objectContaining({
      code: "settings-not-text",
      evidence: expect.objectContaining({
        path: ".claude/settings.json",
        span: expect.objectContaining({ startLine: 1, startColumn: 1 }),
      }),
    }));
    expect(result.runtimes[0]?.evidence.length).toBeGreaterThan(0);
  });
});

describe("safe import inputs", () => {
  it.each([
    ["/absolute/AGENTS.md", "normalized relative"],
    ["../AGENTS.md", "normalized relative"],
    ["folder/../../AGENTS.md", "normalized relative"],
    ["C:\\secret\\AGENTS.md", "normalized relative"],
  ])("rejects unsafe repository path %s", (path, message) => {
    expect(() => sourceSnapshotFromRepository([{ path, bytes: new Uint8Array() }]))
      .toThrow(message);
  });

  it("rejects links, ambiguous collisions, and resource-limit violations", () => {
    expect(() => sourceSnapshotFromRepository([
      { path: "linked", bytes: new Uint8Array(), kind: "symlink" },
    ])).toThrow("links");
    expect(() => sourceSnapshotFromRepository([
      { path: "AGENTS.md", bytes: new Uint8Array() },
      { path: "agents.md", bytes: new Uint8Array() },
    ])).toThrow("ambiguous path collision");
    expect(() => sourceSnapshotFromRepository([{
      path: "large",
      bytes: new Uint8Array(SOURCE_SNAPSHOT_LIMITS.maxFileBytes + 1),
    }])).toThrow("per-file size limit");
  });

  it("parses a local TAR as bytes only and rejects traversal and collision entries", () => {
    const safe = sourceSnapshotFromArchive(tar([
      ["AGENTS.md", new TextEncoder().encode("Do not execute hooks.")],
      [".codex/config.toml", new TextEncoder().encode('hooks = "never-run"')],
    ]), "tar");
    expect(safe.files.map((file) => file.path)).toEqual([".codex/config.toml", "AGENTS.md"]);
    expect(() => sourceSnapshotFromArchive(tar([
      ["../escape", new Uint8Array()],
    ]), "tar")).toThrow("normalized relative");
    expect(() => sourceSnapshotFromArchive(tar([
      ["A", new Uint8Array()],
      ["a", new Uint8Array()],
    ]), "tar")).toThrow("ambiguous path collision");
  });

  it("parses stored ZIP entries and rejects escaping ZIP paths", () => {
    const safe = sourceSnapshotFromArchive(zip([
      ["AGENTS.md", new TextEncoder().encode("ZIP instructions.")],
    ]), "zip");
    expect(new TextDecoder().decode(safe.files[0]?.bytes)).toBe("ZIP instructions.");
    expect(() => sourceSnapshotFromArchive(zip([
      ["../../escape", new Uint8Array()],
    ]), "zip")).toThrow("normalized relative");
  });

  it("rejects TAR links without resolving their targets", () => {
    const archive = tar([["linked", new TextEncoder().encode("../escape")]], "2");
    expect(() => sourceSnapshotFromArchive(archive, "tar")).toThrow("links and special entries");
  });

  it("rejects malformed and over-limit archives deterministically", () => {
    expect(() => sourceSnapshotFromArchive(new Uint8Array(32), "zip")).toThrow("end record");
    expect(() => sourceSnapshotFromArchive(
      new Uint8Array(SOURCE_SNAPSHOT_LIMITS.maxArchiveBytes + 1),
      "tar",
    )).toThrow("compressed-byte limit");
  });
});

function tar(
  entries: readonly (readonly [string, Uint8Array])[],
  type = "0",
): Uint8Array {
  const chunks: Uint8Array[] = [];
  for (const [path, bytes] of entries) {
    const header = new Uint8Array(512);
    header.set(new TextEncoder().encode(path), 0);
    const size = bytes.byteLength.toString(8).padStart(11, "0");
    header.set(new TextEncoder().encode(`${size}\0`), 124);
    header[156] = type.charCodeAt(0);
    chunks.push(header, bytes, new Uint8Array((512 - bytes.byteLength % 512) % 512));
  }
  chunks.push(new Uint8Array(1024));
  const output = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function zip(entries: readonly (readonly [string, Uint8Array])[]): Uint8Array {
  const localChunks: Uint8Array[] = [];
  const centralChunks: Uint8Array[] = [];
  let localOffset = 0;
  for (const [path, bytes] of entries) {
    const name = new TextEncoder().encode(path);
    const local = new Uint8Array(30 + name.length + bytes.length);
    write32(local, 0, 0x04034b50);
    write16(local, 4, 20);
    write16(local, 8, 0);
    write32(local, 18, bytes.length);
    write32(local, 22, bytes.length);
    write16(local, 26, name.length);
    local.set(name, 30);
    local.set(bytes, 30 + name.length);
    localChunks.push(local);

    const central = new Uint8Array(46 + name.length);
    write32(central, 0, 0x02014b50);
    write16(central, 4, 20);
    write16(central, 6, 20);
    write32(central, 20, bytes.length);
    write32(central, 24, bytes.length);
    write16(central, 28, name.length);
    write32(central, 42, localOffset);
    central.set(name, 46);
    centralChunks.push(central);
    localOffset += local.length;
  }
  const centralSize = centralChunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const eocd = new Uint8Array(22);
  write32(eocd, 0, 0x06054b50);
  write16(eocd, 8, entries.length);
  write16(eocd, 10, entries.length);
  write32(eocd, 12, centralSize);
  write32(eocd, 16, localOffset);
  const chunks = [...localChunks, ...centralChunks, eocd];
  const output = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

function write16(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = value >>> 8 & 0xff;
}

function write32(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = value >>> 8 & 0xff;
  bytes[offset + 2] = value >>> 16 & 0xff;
  bytes[offset + 3] = value >>> 24 & 0xff;
}
