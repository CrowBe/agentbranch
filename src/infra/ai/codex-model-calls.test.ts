import { EventEmitter } from "node:events";
import { access, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { PassThrough } from "node:stream";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { ResolvedModel } from "@/modules/model-router";
import { isErr } from "@/shared";
import { createCodexModelCalls, type CodexModelCallsOptions } from "./codex-model-calls";

const model: ResolvedModel = {
  providerId: "codex-cli",
  kind: "codex-cli",
  structuredOutputs: "json-schema",
  modelId: "cli:codex",
  viaOverride: false,
};

let authFixtureRoot = "";
let sourceCodexHome = "";
const observedSessionRoots = new Set<string>();

beforeEach(async () => {
  authFixtureRoot = await mkdtemp(join(tmpdir(), "agentbranch-codex-auth-test-"));
  sourceCodexHome = join(authFixtureRoot, "codex-home");
  await Promise.all([
    mkdir(join(sourceCodexHome, "skills"), { recursive: true }),
    mkdir(join(sourceCodexHome, "cache"), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(join(sourceCodexHome, "auth.json"), '{"tokens":{"access_token":"test-secret"}}', { mode: 0o600 }),
    writeFile(join(sourceCodexHome, "config.toml"), "model = \"must-not-copy\""),
    writeFile(join(sourceCodexHome, "skills", "global.md"), "must-not-copy"),
    writeFile(join(sourceCodexHome, "cache", "models.json"), "must-not-copy"),
  ]);
  vi.stubEnv("CODEX_HOME", sourceCodexHome);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all([
    rm(authFixtureRoot, { recursive: true, force: true }),
    ...[...observedSessionRoots].map((root) => rm(root, { recursive: true, force: true })),
  ]);
  observedSessionRoots.clear();
});

describe("Codex model calls", () => {
  it("spawns classify with native schema, stdin, isolated auth-only homes, and cleans call artifacts", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "must-not-leak");
    let observedCallRoot = "";
    let observedSessionRoot = "";
    const fake = fakeSpawn(async ({ args, options, stdin }) => {
      const schemaPath = valueAfter(args, "--output-schema");
      const outputPath = valueAfter(args, "--output-last-message");
      observedCallRoot = dirname(schemaPath);
      observedSessionRoot = dirname(observedCallRoot);
      const isolatedHome = options.env?.HOME;
      const isolatedCodexHome = options.env?.CODEX_HOME;

      expect(args).toEqual(expect.arrayContaining([
        "exec",
        "--ignore-user-config",
        "--ignore-rules",
        "--ephemeral",
        "--disable",
        "shell_tool",
        "--disable",
        "unified_exec",
        "--sandbox",
        "read-only",
        "--json",
      ]));
      expect(args).not.toContain("-m");
      expect(options.shell).toBe(false);
      expect(options.cwd).toBe(valueAfter(args, "-C"));
      expect(isolatedHome).toBe(join(observedSessionRoot, "home"));
      expect(isolatedCodexHome).toBe(join(observedSessionRoot, "codex-home"));
      expect(isolatedCodexHome).not.toBe(sourceCodexHome);
      expect(options.env?.ANTHROPIC_API_KEY).toBeUndefined();
      expect(options.detached).toBe(process.platform !== "win32");
      expect(await readFile(join(isolatedCodexHome!, "auth.json"), "utf8"))
        .toBe('{"tokens":{"access_token":"test-secret"}}');
      expect((await stat(join(isolatedCodexHome!, "auth.json"))).mode & 0o777).toBe(0o600);
      expect((await stat(isolatedHome!)).mode & 0o777).toBe(0o700);
      expect((await stat(isolatedCodexHome!)).mode & 0o777).toBe(0o700);
      await expect(access(join(isolatedCodexHome!, "config.toml"))).rejects.toThrow();
      await expect(access(join(isolatedCodexHome!, "skills"))).rejects.toThrow();
      await expect(access(join(isolatedCodexHome!, "cache"))).rejects.toThrow();
      expect(stdin).toContain("charged twice");
      expect(JSON.parse(await readFile(schemaPath, "utf8"))).toMatchObject({
        properties: { choice: { anyOf: expect.any(Array) } },
      });
      await writeFile(outputPath, '{"choice":"billing","rationale":"Invoice language."}');
      return {
        stdout: '{"type":"turn.completed","usage":{"input_tokens":12,"output_tokens":3}}\n',
      };
    });
    const calls = createCodexModelCalls({ spawn: fake.spawn });

    const result = await calls.classify(model, {
      choices: ["billing", "weather"],
      prompt: "The invoice was charged twice.",
    });

    expect(isErr(result)).toBe(false);
    if (!isErr(result)) {
      expect(result.value.value.choice).toBe("billing");
      expect(result.value.usage).toMatchObject({ inputTokens: 12, outputTokens: 3 });
    }
    await expect(access(observedCallRoot)).rejects.toThrow();
    await expect(access(observedSessionRoot)).resolves.toBeUndefined();
  });

  it("persists rotated auth and CLI cache across calls without changing or globally copying the source", async () => {
    const callRoots: string[] = [];
    const sessionRoots: string[] = [];
    let invocation = 0;
    const fake = fakeSpawn(async ({ args, options }) => {
      invocation += 1;
      const callRoot = dirname(valueAfter(args, "--output-schema"));
      const sessionRoot = dirname(callRoot);
      const codexHome = options.env!.CODEX_HOME!;
      callRoots.push(callRoot);
      sessionRoots.push(sessionRoot);

      expect(options.env!.HOME).toBe(join(sessionRoot, "home"));
      expect(codexHome).toBe(join(sessionRoot, "codex-home"));
      await expect(access(join(codexHome, "config.toml"))).rejects.toThrow();
      await expect(access(join(codexHome, "skills"))).rejects.toThrow();
      if (invocation === 1) {
        expect(await readFile(join(codexHome, "auth.json"), "utf8"))
          .toBe('{"tokens":{"access_token":"test-secret"}}');
        await writeFile(join(codexHome, "auth.json"), '{"tokens":{"access_token":"rotated"}}', { mode: 0o600 });
        await mkdir(join(codexHome, "cache"));
        await writeFile(join(codexHome, "cache", "models.json"), "session-cache");
      } else {
        expect(await readFile(join(codexHome, "auth.json"), "utf8"))
          .toBe('{"tokens":{"access_token":"rotated"}}');
        expect(await readFile(join(codexHome, "cache", "models.json"), "utf8"))
          .toBe("session-cache");
      }
      await writeFile(
        valueAfter(args, "--output-last-message"),
        '{"choice":"yes","rationale":"Exact match."}',
      );
      return {};
    });
    const calls = createCodexModelCalls({ spawn: fake.spawn });

    for (const prompt of ["first", "second"]) {
      const result = await calls.classify(model, { choices: ["yes"], prompt });
      expect(isErr(result)).toBe(false);
      await expect(access(callRoots.at(-1)!)).rejects.toThrow();
    }

    expect(new Set(sessionRoots).size).toBe(1);
    expect(new Set(callRoots).size).toBe(2);
    expect(await readFile(join(sourceCodexHome, "auth.json"), "utf8"))
      .toBe('{"tokens":{"access_token":"test-secret"}}');
    expect(await readFile(join(sourceCodexHome, "config.toml"), "utf8"))
      .toBe('model = "must-not-copy"');
    expect(await readFile(join(sourceCodexHome, "cache", "models.json"), "utf8"))
      .toBe("must-not-copy");
  });

  it("fails closed before spawn when auth.json is unavailable and cleans session setup", async () => {
    const missingHome = join(authFixtureRoot, "missing-codex-home");
    await mkdir(missingHome);
    vi.stubEnv("CODEX_HOME", missingHome);
    const spawn = vi.fn();
    const calls = createCodexModelCalls({ spawn });

    const result = await calls.classify(model, { choices: ["yes"], prompt: "yes" });

    expect(isErr(result) && result.error.tag).toBe("model_unavailable");
    expect(isErr(result) && result.error.message).toContain("could not be started");
    expect(spawn).not.toHaveBeenCalled();
  });

  it("passes an explicit non-sentinel model with -m and validates generated output", async () => {
    const fake = fakeSpawn(async ({ args }) => {
      await writeFile(valueAfter(args, "--output-last-message"), '{"title":"Hello","wordCount":1}');
      return {};
    });
    const calls = createCodexModelCalls({ spawn: fake.spawn });
    const result = await calls.generate({ ...model, modelId: "gpt-5.4-mini" }, {
      system: "Return the requested object.",
      prompt: "Use title Hello and wordCount 1.",
      schema: z.object({ title: z.string(), wordCount: z.number() }),
    });

    expect(fake.calls[0]?.args).toEqual(expect.arrayContaining(["-m", "gpt-5.4-mini"]));
    expect(isErr(result)).toBe(false);
  });

  it("maps schema mismatches to model_unavailable and cleans the run", async () => {
    let outputPath = "";
    const fake = fakeSpawn(async ({ args }) => {
      outputPath = valueAfter(args, "--output-last-message");
      await writeFile(outputPath, '{"wordCount":"one"}');
      return {};
    });
    const calls = createCodexModelCalls({ spawn: fake.spawn });

    const result = await calls.generate(model, {
      system: "Return an object.",
      prompt: "Count one.",
      schema: z.object({ wordCount: z.number() }),
    });

    expect(isErr(result) && result.error.tag).toBe("model_unavailable");
    await expect(access(outputPath)).rejects.toThrow();
  });

  it("kills and reaps a timed-out child before cleaning up", async () => {
    const fake = fakeSpawn(async () => ({ manualClose: true }));
    const signals: Array<[number, NodeJS.Signals]> = [];
    const calls = createCodexModelCalls({
      spawn: fake.spawn,
      timeoutMs: 5,
      killGraceMs: 2,
      killProcessGroup: (pid, signal) => {
        signals.push([pid, signal]);
        if (signal === "SIGKILL") queueMicrotask(() => fake.children[0]?.emit("close", null, signal));
      },
    });

    const result = await calls.classify(model, { choices: ["yes"], prompt: "yes" });

    expect(isErr(result) && result.error.message).toContain("timed out");
    expect(signals).toEqual([[-4321, "SIGTERM"], [-4321, "SIGKILL"]]);
    await expectArtifactsCleaned(fake.calls[0]!.args);
  });

  it("bounds combined stdout and stderr and terminates overflow", async () => {
    const fake = fakeSpawn(async () => ({ stdout: "123456", stderr: "abcdef" }));
    const signals: Array<NodeJS.Signals> = [];
    const calls = createCodexModelCalls({
      spawn: fake.spawn,
      maxOutputBytes: 10,
      killProcessGroup: (_pid, signal) => { signals.push(signal); },
    });

    const result = await calls.classify(model, { choices: ["yes"], prompt: "yes" });

    expect(isErr(result) && result.error.message).toContain("10-byte output limit");
    expect(signals).toContain("SIGTERM");
    await expectArtifactsCleaned(fake.calls[0]!.args);
  });

  it("maps a missing binary spawn error to model_unavailable", async () => {
    const fake = fakeSpawn(async ({ child }) => {
      queueMicrotask(() => child.emit("error", Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" })));
      return { manualClose: true };
    });
    const calls = createCodexModelCalls({ spawn: fake.spawn });

    const result = await calls.classify(model, { choices: ["yes"], prompt: "yes" });

    expect(isErr(result) && result.error.tag).toBe("model_unavailable");
    expect(isErr(result) && result.error.message).toContain("could not be started");
    await expectArtifactsCleaned(fake.calls[0]!.args);
  });

  it("defaults to one concurrent CLI child and rejects a higher configured cap", async () => {
    let active = 0;
    let maximum = 0;
    const fake = fakeSpawn(async ({ args }) => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      await writeFile(valueAfter(args, "--output-last-message"), '{"choice":"yes","rationale":"Exact match."}');
      active -= 1;
      return {};
    });
    const calls = createCodexModelCalls({ spawn: fake.spawn });

    await Promise.all([
      calls.classify(model, { choices: ["yes"], prompt: "first" }),
      calls.classify(model, { choices: ["yes"], prompt: "second" }),
    ]);

    expect(maximum).toBe(1);
    expect(() => createCodexModelCalls({ concurrency: 2 }))
      .toThrow("concurrency must be exactly 1");
  });

  it("reports agent primitives as honestly unavailable", async () => {
    const calls = createCodexModelCalls();
    const input = { system: "system", messages: [], tools: [] };

    const result = await calls.runAgent(model, input);
    const parts = [];
    for await (const part of calls.streamAgent(model, input).parts) parts.push(part);

    expect(isErr(result) && result.error.tag).toBe("model_unavailable");
    expect(isErr(result) && result.error.message).toContain("covers classify/generate");
    expect(parts).toEqual([
      expect.objectContaining({ kind: "error", message: expect.stringContaining("Claude Code rung") }),
    ]);
  });
});

function fakeSpawn(
  handler: (call: FakeCall) => Promise<{ stdout?: string; stderr?: string; exitCode?: number; manualClose?: boolean }>,
) {
  const calls: Array<{ command: string; args: readonly string[]; options: Parameters<NonNullable<CodexModelCallsOptions["spawn"]>>[2] }> = [];
  const children: ChildProcessWithoutNullStreams[] = [];
  const spawn = (command: string, args: readonly string[], options: Parameters<NonNullable<CodexModelCallsOptions["spawn"]>>[2]) => {
    const child = fakeChild();
    if (options.env?.HOME) observedSessionRoots.add(dirname(options.env.HOME));
    calls.push({ command, args, options });
    children.push(child);
    let stdin = "";
    child.stdin.on("data", (chunk) => { stdin += chunk.toString(); });
    child.stdin.once("finish", async () => {
      const outcome = await handler({ args, options, stdin, child });
      if (outcome.stdout) (child.stdout as PassThrough).write(outcome.stdout);
      if (outcome.stderr) (child.stderr as PassThrough).write(outcome.stderr);
      if (!outcome.manualClose) {
        (child.stdout as PassThrough).end();
        (child.stderr as PassThrough).end();
        child.emit("close", outcome.exitCode ?? 0, null);
      }
    });
    return child;
  };
  return { spawn, calls, children };
}

type FakeCall = {
  readonly args: readonly string[];
  readonly options: Parameters<NonNullable<CodexModelCallsOptions["spawn"]>>[2];
  readonly stdin: string;
  readonly child: ChildProcessWithoutNullStreams;
};

function fakeChild(): ChildProcessWithoutNullStreams {
  const emitter = new EventEmitter() as ChildProcessWithoutNullStreams;
  Object.assign(emitter, {
    pid: 4321,
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(() => true),
  });
  return emitter;
}

function valueAfter(args: readonly string[], flag: string): string {
  const index = args.indexOf(flag);
  const value = args[index + 1];
  if (index < 0 || value === undefined) throw new Error(`Missing ${flag}`);
  return value;
}

async function expectArtifactsCleaned(args: readonly string[]): Promise<void> {
  const root = dirname(valueAfter(args, "--output-schema"));
  await expect(access(root)).rejects.toThrow();
}
