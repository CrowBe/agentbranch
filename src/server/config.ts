import type {
  ModelSelection,
  PrimitiveModelIds,
  ProviderId,
  ProviderProfile,
} from "@/modules/model-router";

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
  readonly modelIds: {
    readonly default: string;
    readonly classify: string;
    readonly generate: string;
    readonly runAgent: string;
    readonly streamAgent: string;
  };
  /**
   * The model-router registry: every provider the platform knows, the server-pool
   * keys behind them, and the boot-time active selection. Env sets the defaults;
   * the model console switches provider/model at runtime (ARCHITECTURE §4).
   */
  readonly providerRegistry: readonly ProviderProfile[];
  readonly serverKeys: Readonly<Record<ProviderId, { apiKey?: string; baseUrl?: string }>>;
  readonly defaultSelection: ModelSelection;
  /**
   * Admin allowlist for instance-wide surfaces (the model console). When auth is
   * configured, only these identities may read or change the active selection /
   * credentials; with no list set, the surface is locked (fail-safe).
   */
  readonly admin: { readonly userIds: readonly string[]; readonly emails: readonly string[] };
  readonly clerkConfigured: boolean;
  readonly clerkProPlanSlug: string;
  /**
   * Shared secret the scheduled retention job presents (Vercel Cron sends it as
   * `Authorization: Bearer …`). Unset ⇒ the cron route is locked (fail-safe),
   * the same posture as the admin allowlist.
   */
  readonly cronSecret: string | undefined;
  readonly flags: {
    readonly hasDatabase: boolean;
    readonly hasModel: boolean;
    readonly hasAuth: boolean;
  };
};

export type ModelProviderKind = "anthropic" | "nous";

export const DEFAULT_ANTHROPIC_MODEL = "claude-opus-4-8";
export const DEFAULT_ANTHROPIC_CLASSIFY_MODEL = "claude-haiku-4-5";
export const DEFAULT_ANTHROPIC_GENERATE_MODEL = "claude-sonnet-4-6";
export const DEFAULT_NOUS_MODEL = "deepseek/deepseek-v4-flash";
export const DEFAULT_NOUS_BASE_URL = "https://inference-api.nousresearch.com/v1";

export function readConfig(): AppConfig {
  const databaseUrl = nonEmpty(process.env.DATABASE_URL);
  const anthropicApiKey = nonEmpty(process.env.ANTHROPIC_API_KEY);
  const nousApiKey = nonEmpty(process.env.NOUS_API_KEY);
  const modelProvider = readModelProvider({
    explicit: nonEmpty(process.env.AGENTBRANCH_MODEL_PROVIDER),
    anthropicApiKey,
    nousApiKey,
  });
  const modelId =
    nonEmpty(process.env.AGENTBRANCH_MODEL) ??
    (modelProvider === "nous" ? DEFAULT_NOUS_MODEL : DEFAULT_ANTHROPIC_MODEL);
  const modelIds = {
    default: modelId,
    classify:
      nonEmpty(process.env.AGENTBRANCH_CLASSIFY_MODEL) ??
      (modelProvider === "nous" ? modelId : DEFAULT_ANTHROPIC_CLASSIFY_MODEL),
    generate:
      nonEmpty(process.env.AGENTBRANCH_GENERATE_MODEL) ??
      (modelProvider === "nous" ? modelId : DEFAULT_ANTHROPIC_GENERATE_MODEL),
    runAgent: nonEmpty(process.env.AGENTBRANCH_RUN_AGENT_MODEL) ?? modelId,
    streamAgent: nonEmpty(process.env.AGENTBRANCH_STREAM_AGENT_MODEL) ?? modelId,
  };
  const clerkConfigured =
    nonEmpty(process.env.CLERK_SECRET_KEY) !== undefined &&
    nonEmpty(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) !== undefined;

  const nousBaseUrl = nonEmpty(process.env.NOUS_BASE_URL) ?? DEFAULT_NOUS_BASE_URL;
  // Per-provider model ids: the active provider honours the env routes; the
  // other provider takes its own sensible defaults so it is ready to switch to.
  const anthropicModelIds: PrimitiveModelIds = {
    default: modelProvider === "anthropic" ? modelId : DEFAULT_ANTHROPIC_MODEL,
    classify: nonEmpty(process.env.AGENTBRANCH_CLASSIFY_MODEL) ?? DEFAULT_ANTHROPIC_CLASSIFY_MODEL,
    generate: nonEmpty(process.env.AGENTBRANCH_GENERATE_MODEL) ?? DEFAULT_ANTHROPIC_GENERATE_MODEL,
    runAgent:
      nonEmpty(process.env.AGENTBRANCH_RUN_AGENT_MODEL) ??
      (modelProvider === "anthropic" ? modelId : DEFAULT_ANTHROPIC_MODEL),
    streamAgent:
      nonEmpty(process.env.AGENTBRANCH_STREAM_AGENT_MODEL) ??
      (modelProvider === "anthropic" ? modelId : DEFAULT_ANTHROPIC_MODEL),
  };
  const nousModel = modelProvider === "nous" ? modelId : DEFAULT_NOUS_MODEL;
  const nousModelIds: PrimitiveModelIds = {
    default: nousModel,
    classify: modelProvider === "nous" ? modelIds.classify : nousModel,
    generate: modelProvider === "nous" ? modelIds.generate : nousModel,
    runAgent: modelProvider === "nous" ? modelIds.runAgent : nousModel,
    streamAgent: modelProvider === "nous" ? modelIds.streamAgent : nousModel,
  };
  const providerRegistry: readonly ProviderProfile[] = [
    { id: "anthropic", label: "Anthropic (Claude)", kind: "anthropic", modelIds: anthropicModelIds },
    {
      id: "nous",
      label: "Nous Portal",
      kind: "openai-compatible",
      baseUrl: nousBaseUrl,
      modelIds: nousModelIds,
    },
  ];
  const serverKeys = {
    anthropic: { apiKey: anthropicApiKey },
    nous: { apiKey: nousApiKey, baseUrl: nousBaseUrl },
  };

  return {
    databaseUrl,
    modelProvider,
    anthropicApiKey,
    nousApiKey,
    nousBaseUrl,
    modelId,
    modelIds,
    providerRegistry,
    serverKeys,
    defaultSelection: { providerId: modelProvider },
    admin: {
      userIds: parseList(process.env.AGENTBRANCH_ADMIN_USER_IDS),
      emails: parseList(process.env.AGENTBRANCH_ADMIN_EMAILS).map((email) => email.toLowerCase()),
    },
    clerkConfigured,
    clerkProPlanSlug: nonEmpty(process.env.AGENTBRANCH_PRO_PLAN_SLUG) ?? "pro",
    cronSecret: nonEmpty(process.env.CRON_SECRET),
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
    `Unsupported AGENTBRANCH_MODEL_PROVIDER "${params.explicit}". Use "anthropic" or "nous".`,
  );
}

function nonEmpty(value: string | undefined): string | undefined {
  return value && value.trim().length > 0 ? value : undefined;
}

/** Split a comma-separated env value into trimmed, non-empty entries. */
function parseList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}
