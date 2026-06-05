/**
 * Environment config + feature flags, read once. Missing secrets are not an
 * error: each flag flips the composition root (container.ts) to a stub/memory
 * adapter, so the architecture shell runs offline.
 */
export type AppConfig = {
  readonly databaseUrl: string | undefined;
  readonly modelProvider: ModelProviderKind;
  readonly anthropicApiKey: string | undefined;
  readonly nousApiKey: string | undefined;
  readonly nousBaseUrl: string;
  readonly modelId: string;
  readonly clerkConfigured: boolean;
  readonly flags: {
    readonly hasDatabase: boolean;
    readonly hasModel: boolean;
    readonly hasAuth: boolean;
  };
};

export type ModelProviderKind = "anthropic" | "nous";

export const DEFAULT_ANTHROPIC_MODEL = "claude-opus-4-8";
export const DEFAULT_NOUS_MODEL = "Hermes-4.3-36B";
export const DEFAULT_NOUS_BASE_URL = "https://inference-api.nousresearch.com/v1";

export function readConfig(): AppConfig {
  const databaseUrl = nonEmpty(process.env.DATABASE_URL);
  const anthropicApiKey = nonEmpty(process.env.ANTHROPIC_API_KEY);
  const nousApiKey = nonEmpty(process.env.NOUS_API_KEY);
  const modelProvider = readModelProvider({
    explicit: nonEmpty(process.env.SKILLBUILDER_MODEL_PROVIDER),
    anthropicApiKey,
    nousApiKey,
  });
  const modelId =
    nonEmpty(process.env.SKILLBUILDER_MODEL) ??
    (modelProvider === "nous" ? DEFAULT_NOUS_MODEL : DEFAULT_ANTHROPIC_MODEL);
  const clerkConfigured =
    nonEmpty(process.env.CLERK_SECRET_KEY) !== undefined &&
    nonEmpty(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) !== undefined;

  return {
    databaseUrl,
    modelProvider,
    anthropicApiKey,
    nousApiKey,
    nousBaseUrl: nonEmpty(process.env.NOUS_BASE_URL) ?? DEFAULT_NOUS_BASE_URL,
    modelId,
    clerkConfigured,
    flags: {
      hasDatabase: databaseUrl !== undefined,
      hasModel:
        modelProvider === "nous" ? nousApiKey !== undefined : anthropicApiKey !== undefined,
      hasAuth: clerkConfigured,
    },
  };
}

function readModelProvider(params: {
  explicit: string | undefined;
  anthropicApiKey: string | undefined;
  nousApiKey: string | undefined;
}): ModelProviderKind {
  if (!params.explicit) {
    return params.nousApiKey && !params.anthropicApiKey ? "nous" : "anthropic";
  }
  if (params.explicit === "anthropic" || params.explicit === "nous") {
    return params.explicit;
  }
  throw new Error(
    `Unsupported SKILLBUILDER_MODEL_PROVIDER "${params.explicit}". Use "anthropic" or "nous".`,
  );
}

function nonEmpty(value: string | undefined): string | undefined {
  return value && value.trim().length > 0 ? value : undefined;
}
