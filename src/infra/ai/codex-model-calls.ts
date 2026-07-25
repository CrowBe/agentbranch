import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptionsWithoutStdio } from "node:child_process";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import type {
  RawAgentInput,
  RawAgentStream,
  RawClassifyInput,
  RawGenerateInput,
  RawModelCalls,
} from "@/modules/model-gateway";
import type { ResolvedModel } from "@/modules/model-router";
import type { TokenUsageBreakdown } from "@/modules/usage";
import { domainError, err, ok, type DomainError, type Result } from "@/shared";

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_KILL_GRACE_MS = 1_000;
const DEFAULT_CONCURRENCY = 1;
const DEFAULT_MAX_OUTPUT_BYTES = 1_048_576;
const CODEX_AGENT_UNAVAILABLE =
  "The Codex dev rung covers classify/generate; use the Claude Code rung for agent turns.";

type SpawnFn = (
  command: string,
  args: readonly string[],
  options: SpawnOptionsWithoutStdio,
) => ChildProcessWithoutNullStreams;

export type CodexModelCallsOptions = {
  readonly binary?: string;
  readonly timeoutMs?: number;
  readonly killGraceMs?: number;
  readonly maxOutputBytes?: number;
  readonly concurrency?: number;
  readonly spawn?: SpawnFn;
  readonly killProcessGroup?: (pid: number, signal: NodeJS.Signals) => void;
};

/** Codex CLI dev rung: native structured classify/generate, no agent-tool bridge. */
export function createCodexModelCalls(options: CodexModelCallsOptions = {}): RawModelCalls {
  const run = createCodexRunner(options);
  const unavailable = async () => err(domainError("model_unavailable", CODEX_AGENT_UNAVAILABLE));

  return {
    async classify(model: ResolvedModel, input: RawClassifyInput) {
      const schema = {
        type: "object",
        properties: {
          choice: { anyOf: [{ type: "string", enum: [...input.choices] }, { type: "null" }] },
          rationale: { type: "string" },
        },
        required: ["choice", "rationale"],
        additionalProperties: false,
      };
      const parsed = await run(model, classifyPrompt(input), schema);
      if (!parsed.ok) return parsed;
      const classification = readClassification(parsed.value.value, input.choices);
      if (classification === undefined) {
        return err(domainError("model_unavailable", "Codex returned an invalid classification."));
      }
      return ok({ value: classification, usage: parsed.value.usage });
    },

    generate: async <T>(model: ResolvedModel, input: RawGenerateInput<T>) => {
      const parsed = await run(model, `${input.system}\n\n${input.prompt}`, z.toJSONSchema(input.schema));
      if (!parsed.ok) return parsed;
      const validated = input.schema.safeParse(parsed.value.value);
      return validated.success
        ? ok({ value: validated.data, usage: parsed.value.usage })
        : err(domainError("model_unavailable", "Codex returned output that did not match the requested schema.", validated.error));
    },

    runAgent: unavailable,

    streamAgent(): RawAgentStream {
      async function* parts() {
        yield { kind: "error" as const, message: CODEX_AGENT_UNAVAILABLE };
      }
      return { parts: parts(), usage: async () => zeroUsage() };
    },
  };
}

function createCodexRunner(options: CodexModelCallsOptions) {
  const spawnProcess = options.spawn ?? (spawn as SpawnFn);
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
  if (concurrency !== 1) {
    throw new Error("Codex concurrency must be exactly 1 to preserve isolated session auth.");
  }
  const semaphore = new Semaphore(concurrency);
  let sessionPromise: Promise<CodexSession> | undefined;
  const session = () => {
    sessionPromise ??= createCodexSession();
    return sessionPromise;
  };

  return async (
    model: ResolvedModel,
    prompt: string,
    outputSchema: unknown,
  ): Promise<Result<{ value: unknown; usage: TokenUsageBreakdown }, DomainError>> => {
    const release = await semaphore.acquire();
    let callRoot: string | undefined;
    try {
      const adapterSession = await session();
      callRoot = await mkdtemp(join(adapterSession.root, "run-"));
      const scratch = join(callRoot, "scratch");
      const schemaPath = join(callRoot, "schema.json");
      const outputPath = join(callRoot, "last-message.json");
      await Promise.all([
        mkdir(scratch, { mode: 0o700 }),
        writeFile(schemaPath, JSON.stringify(outputSchema), { mode: 0o600 }),
      ]);

      const args = [
        "exec",
        "--ignore-user-config",
        "--ignore-rules",
        "--ephemeral",
        "--disable",
        "shell_tool",
        "--disable",
        "unified_exec",
        "--disable",
        "shell_snapshot",
        "--disable",
        "browser_use",
        "--disable",
        "computer_use",
        "--disable",
        "apps",
        "--disable",
        "multi_agent",
        "--disable",
        "web_search_request",
        "--sandbox",
        "read-only",
        "--skip-git-repo-check",
        "--json",
        "--output-schema",
        schemaPath,
        "--output-last-message",
        outputPath,
        "-C",
        scratch,
      ];
      // cli:codex is the v1 accounting sentinel, not a CLI model identifier.
      if (model.modelId !== "cli:codex") args.push("-m", model.modelId);
      args.push("-");

      const child = spawnProcess(options.binary ?? "codex", args, {
        cwd: scratch,
        env: codexEnvironment(adapterSession.home, adapterSession.codexHome),
        detached: process.platform !== "win32",
        shell: false,
        stdio: "pipe",
      });
      let stdout = "";
      let stderr = "";
      let outputBytes = 0;
      const watcher = watchChild(child, {
        timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        killGraceMs: options.killGraceMs ?? DEFAULT_KILL_GRACE_MS,
        killProcessGroup: options.killProcessGroup ?? process.kill,
      });
      const capture = (chunk: string, stream: "stdout" | "stderr") => {
        const bytes = Buffer.byteLength(chunk);
        if (outputBytes + bytes > (options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES)) {
          watcher.terminate(
            `Codex CLI exceeded the ${(options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES)}-byte output limit.`,
          );
          return;
        }
        outputBytes += bytes;
        if (stream === "stdout") stdout += chunk;
        else stderr += chunk;
      };
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => capture(chunk, "stdout"));
      child.stderr.on("data", (chunk: string) => capture(chunk, "stderr"));
      child.stdin.end(pureInferencePrompt(prompt));

      const completed = await watcher.completed;
      if (!completed.ok) return err(completed.error);
      if (completed.value !== 0) {
        return err(domainError("model_unavailable", cliFailure(stderr, completed.value)));
      }

      let value: unknown;
      try {
        value = JSON.parse(await readFile(outputPath, "utf8"));
      } catch (cause) {
        return err(domainError("model_unavailable", "Codex returned no parseable final message.", cause));
      }
      return ok({ value, usage: usageFromJsonl(stdout) });
    } catch (cause) {
      return err(domainError("model_unavailable", "Codex CLI could not be started.", cause));
    } finally {
      try {
        if (callRoot) await rm(callRoot, { recursive: true, force: true });
      } finally {
        release();
      }
    }
  };
}

type CodexSession = {
  readonly root: string;
  readonly home: string;
  readonly codexHome: string;
};

async function createCodexSession(): Promise<CodexSession> {
  const root = await mkdtemp(join(tmpdir(), "agentbranch-codex-"));
  try {
    const home = join(root, "home");
    const codexHome = join(root, "codex-home");
    await Promise.all([
      chmod(root, 0o700),
      mkdir(home, { mode: 0o700 }),
      mkdir(codexHome, { mode: 0o700 }),
    ]);
    await copyCodexAuth(codexHome);
    return { root, home, codexHome };
  } catch (cause) {
    await rm(root, { recursive: true, force: true });
    throw cause;
  }
}

function watchChild(
  child: ChildProcessWithoutNullStreams,
  options: {
    readonly timeoutMs: number;
    readonly killGraceMs: number;
    readonly killProcessGroup: (pid: number, signal: NodeJS.Signals) => void;
  },
): {
  readonly completed: Promise<Result<number, DomainError>>;
  terminate(message: string): void;
} {
  let terminationMessage: string | undefined;
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  const signal = (signalName: NodeJS.Signals) => {
    if (child.pid !== undefined && process.platform !== "win32") {
      try {
        options.killProcessGroup(-child.pid, signalName);
        return;
      } catch {
        // Fall back to the direct child when the process group no longer exists.
      }
    }
    child.kill(signalName);
  };
  const terminate = (message: string) => {
    if (terminationMessage !== undefined) return;
    terminationMessage = message;
    signal("SIGTERM");
    killTimer = setTimeout(() => signal("SIGKILL"), options.killGraceMs);
  };
  const completed = new Promise<Result<number, DomainError>>((resolve) => {
    const timer = setTimeout(
      () => terminate(`Codex CLI timed out after ${options.timeoutMs}ms.`),
      options.timeoutMs,
    );
    child.once("error", (cause) => {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      resolve(err(domainError("model_unavailable", "Codex CLI could not be started.", cause)));
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      resolve(
        terminationMessage
          ? err(domainError("model_unavailable", terminationMessage))
          : ok(code ?? 1),
      );
    });
  });
  return { completed, terminate };
}

async function copyCodexAuth(codexHome: string): Promise<void> {
  const sourceHome = process.env.CODEX_HOME;
  if (!sourceHome) {
    throw new Error("CODEX_HOME is required for the subscription-authenticated Codex rung.");
  }
  const destination = join(codexHome, "auth.json");
  await copyFile(join(sourceHome, "auth.json"), destination);
  await chmod(destination, 0o600);
}

function codexEnvironment(home: string, codexHome: string): NodeJS.ProcessEnv {
  const allowed = [
    "PATH",
    "TMPDIR",
    "LANG",
    "LC_ALL",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "NO_PROXY",
    "ALL_PROXY",
  ] as const;
  const environment = Object.fromEntries(
    allowed.flatMap((name) => process.env[name] === undefined ? [] : [[name, process.env[name]]]),
  ) as NodeJS.ProcessEnv;
  environment.HOME = home;
  environment.CODEX_HOME = codexHome;
  return environment;
}

function classifyPrompt(input: RawClassifyInput): string {
  return [
    "Classify the input using exactly one supplied choice, or null when none fits.",
    `Choices: ${JSON.stringify(input.choices)}`,
    `Input: ${input.prompt}`,
  ].join("\n");
}

function pureInferencePrompt(prompt: string): string {
  return [
    "This is a pure structured-inference request.",
    "Do not inspect the host, execute commands, browse, delegate, or call tools.",
    "Use only the information in this prompt and return the requested structured result.",
    "",
    prompt,
  ].join("\n");
}

function readClassification(
  value: unknown,
  choices: readonly string[],
): { readonly choice: string | null; readonly rationale: string } | undefined {
  if (!value || typeof value !== "object") return undefined;
  const { choice, rationale } = value as { choice?: unknown; rationale?: unknown };
  if (typeof rationale !== "string") return undefined;
  return choice === null || (typeof choice === "string" && choices.includes(choice))
    ? { choice, rationale }
    : undefined;
}

function cliFailure(stderr: string, exitCode: number): string {
  const detail = stderr.trim();
  return detail
    ? `Codex CLI exited with code ${exitCode}: ${detail}`
    : `Codex CLI exited with code ${exitCode}.`;
}

function usageFromJsonl(stdout: string): TokenUsageBreakdown {
  let usage = zeroUsage();
  for (const line of stdout.split("\n")) {
    try {
      const event = JSON.parse(line) as unknown;
      const candidate = findUsage(event);
      if (candidate && totalTokens(candidate) >= totalTokens(usage)) usage = candidate;
    } catch {
      // Non-event output is ignored; usage is optional and zero-priced.
    }
  }
  return usage;
}

function findUsage(value: unknown): TokenUsageBreakdown | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const input = numberAt(record, "input_tokens", "inputTokens");
  const output = numberAt(record, "output_tokens", "outputTokens");
  if (input !== undefined || output !== undefined) {
    const cacheRead =
      numberAt(record, "cached_input_tokens", "cacheReadInputTokens") ?? 0;
    return {
      inputTokens: Math.max(0, (input ?? 0) - cacheRead),
      outputTokens: output ?? 0,
      cacheReadInputTokens: cacheRead,
      cacheCreationInputTokens: 0,
    };
  }
  for (const child of Object.values(record)) {
    const found = findUsage(child);
    if (found) return found;
  }
  return null;
}

function numberAt(record: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const key of keys) if (typeof record[key] === "number") return record[key];
  return undefined;
}

function zeroUsage(): TokenUsageBreakdown {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
  };
}

function totalTokens(usage: TokenUsageBreakdown): number {
  return usage.inputTokens + usage.outputTokens + usage.cacheReadInputTokens + usage.cacheCreationInputTokens;
}

class Semaphore {
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(private readonly limit: number) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error("Codex concurrency must be at least 1.");
  }

  async acquire(): Promise<() => void> {
    if (this.active >= this.limit) await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.active += 1;
    return () => {
      this.active -= 1;
      this.waiting.shift()?.();
    };
  }
}
