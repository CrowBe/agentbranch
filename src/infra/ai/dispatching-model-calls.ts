import type {
  RawAgentInput,
  RawAgentStream,
  RawClassifyInput,
  RawGenerateInput,
  RawModelCalls,
} from "@/modules/model-gateway";
import type { ProviderKind, ResolvedModel } from "@/modules/model-router";
import { domainError, err } from "@/shared";

type CliKind = Extract<ProviderKind, "claude-code-cli" | "codex-cli">;

/** Routes resolved providers to their raw adapter without weakening gateway accounting. */
export function createDispatchingModelCalls(deps: {
  sdk: RawModelCalls;
  cli?: Partial<Record<CliKind, RawModelCalls>>;
}): RawModelCalls {
  const adapterFor = (resolved: ResolvedModel): RawModelCalls => {
    if (resolved.kind === "claude-code-cli" || resolved.kind === "codex-cli") {
      return deps.cli?.[resolved.kind] ?? unavailableCliCalls(resolved.kind);
    }
    return deps.sdk;
  };

  return {
    classify: (resolved: ResolvedModel, input: RawClassifyInput) =>
      adapterFor(resolved).classify(resolved, input),
    runAgent: (resolved: ResolvedModel, input: RawAgentInput) =>
      adapterFor(resolved).runAgent(resolved, input),
    streamAgent: (resolved: ResolvedModel, input: RawAgentInput) =>
      adapterFor(resolved).streamAgent(resolved, input),
    generate: <T>(resolved: ResolvedModel, input: RawGenerateInput<T>) =>
      adapterFor(resolved).generate(resolved, input),
  };
}

function unavailableCliCalls(kind: CliKind): RawModelCalls {
  const failure = async () =>
    err(domainError("model_unavailable", `No raw model-call adapter is registered for ${kind}.`));
  return {
    classify: failure,
    runAgent: failure,
    generate: failure,
    streamAgent(): RawAgentStream {
      async function* parts() {
        yield {
          kind: "error" as const,
          message: `No raw model-call adapter is registered for ${kind}.`,
        };
      }
      return {
        parts: parts(),
        usage: async () => ({
          inputTokens: 0,
          outputTokens: 0,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
        }),
      };
    },
  };
}
