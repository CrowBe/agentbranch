/**
 * Environment config + feature flags, read once. Missing secrets are not an
 * error: each flag flips the composition root (container.ts) to a stub/memory
 * adapter, so the architecture shell runs offline.
 */
export type AppConfig = {
  readonly databaseUrl: string | undefined;
  readonly anthropicApiKey: string | undefined;
  readonly modelId: string;
  readonly clerkConfigured: boolean;
  readonly flags: {
    readonly hasDatabase: boolean;
    readonly hasModel: boolean;
    readonly hasAuth: boolean;
  };
};

export function readConfig(): AppConfig {
  const databaseUrl = nonEmpty(process.env.DATABASE_URL);
  const anthropicApiKey = nonEmpty(process.env.ANTHROPIC_API_KEY);
  const clerkConfigured =
    nonEmpty(process.env.CLERK_SECRET_KEY) !== undefined &&
    nonEmpty(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) !== undefined;

  return {
    databaseUrl,
    anthropicApiKey,
    modelId: nonEmpty(process.env.SKILLBUILDER_MODEL) ?? "claude-opus-4-8",
    clerkConfigured,
    flags: {
      hasDatabase: databaseUrl !== undefined,
      hasModel: anthropicApiKey !== undefined,
      hasAuth: clerkConfigured,
    },
  };
}

function nonEmpty(value: string | undefined): string | undefined {
  return value && value.trim().length > 0 ? value : undefined;
}
