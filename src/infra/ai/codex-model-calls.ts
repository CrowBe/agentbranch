import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptionsWithoutStdio } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
const DEFAULT_CONCURRENCY = 2;
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
  readonly concurrency?: number;
  readonly spawn?: SpawnFn;
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
  const semaphore = new Semaphore(options.concurrency ?? DEFAULT_CONCURRENCY);

  return async (
    model: ResolvedModel,
    prompt: string,
    outputSchema: unknown,
  ): Promise<Result<{ value: unknown; usage: TokenUsageBreakdown }, DomainError>> => {
    const release = await semaphore.acquire();
    let runRoot: string | undefined;
    try {
      runRoot = await mkdtemp(join(tmpdir(), "agentbranch-codex-"));
      const scratch = join(runRoot, "scratch");
      const schemaPath = join(runRoot, "schema.json");
      const outputPath = join(runRoot, "last-message.json");
      await Promise.all([mkdir(scratch), writeFile(schemaPath, JSON.stringify(outputSchema))]);

      const args = [
        "exec",
        "--ignore-user-config",
        "--ignore-rules",
        "--ephemeral",
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
        env: { ...process.env },
        shell: false,
        stdio: "pipe",
      });
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => { stdout += chunk; });
      child.stderr.on("data", (chunk: string) => { stderr += chunk; });
      child.stdin.end(prompt);

      const completed = await waitForChild(child, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
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
        if (runRoot) await rm(runRoot, { recursive: true, force: true });
      } finally {
        release();
      }
    }
  };
}

function waitForChild(
  child: ChildProcessWithoutNullStreams,
  timeoutMs: number,
): Promise<Result<number, DomainError>> {
  return new Promise((resolve) => {
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);
    child.once("error", (cause) => {
      clearTimeout(timer);
      resolve(err(domainError("model_unavailable", "Codex CLI could not be started.", cause)));
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve(
        timedOut
          ? err(domainError("model_unavailable", `Codex CLI timed out after ${timeoutMs}ms.`))
          : ok(code ?? 1),
      );
    });
  });
}

function classifyPrompt(input: RawClassifyInput): string {
  return [
    "Classify the input using exactly one supplied choice, or null when none fits.",
    `Choices: ${JSON.stringify(input.choices)}`,
    `Input: ${input.prompt}`,
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
