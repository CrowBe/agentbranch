import type {
  RawAgentStream,
  RawModelCalls,
} from "@/modules/model-gateway";
import type { DomainError, Result } from "@/shared";

const CODEX_AGENT_UNAVAILABLE =
  "The Codex dev rung covers classify/generate; use the Claude Code rung for agent turns.";
const CODEX_PRODUCTION_UNAVAILABLE =
  "The Codex CLI rung is available only in development.";

/**
 * Keeps the filesystem-backed Codex process runner out of production route
 * traces. Configuration already rejects dev CLI providers in production; this
 * boundary makes that separation visible to the bundler as well.
 */
export function createLazyCodexModelCalls(): RawModelCalls {
  let loaded: Promise<RawModelCalls> | undefined;
  const load = () => {
    if (process.env.NODE_ENV === "production") {
      return Promise.resolve(unavailableCalls(CODEX_PRODUCTION_UNAVAILABLE));
    }
    loaded ??= import("./codex-model-calls").then(({ createCodexModelCalls }) =>
      createCodexModelCalls()
    );
    return loaded;
  };

  return {
    async classify(model, input) {
      return (await load()).classify(model, input);
    },
    async generate(model, input) {
      return (await load()).generate(model, input);
    },
    async runAgent() {
      return unavailableResult(CODEX_AGENT_UNAVAILABLE);
    },
    streamAgent(): RawAgentStream {
      async function* parts() {
        yield { kind: "error" as const, message: CODEX_AGENT_UNAVAILABLE };
      }
      return { parts: parts(), usage: async () => zeroUsage() };
    },
  };
}

function unavailableCalls(message: string): RawModelCalls {
  return {
    classify: async () => unavailableResult(message),
    generate: async () => unavailableResult(message),
    runAgent: async () => unavailableResult(message),
    streamAgent(): RawAgentStream {
      async function* parts() {
        yield { kind: "error" as const, message };
      }
      return { parts: parts(), usage: async () => zeroUsage() };
    },
  };
}

function unavailableResult<T>(message: string): Result<T, DomainError> {
  return {
    ok: false,
    error: { tag: "model_unavailable", message },
  };
}

function zeroUsage() {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
  };
}
