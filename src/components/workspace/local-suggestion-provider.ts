/** Browser-local, editable suggestions beside the metered model gateway. */
export type LocalSuggestionAvailability = "available" | "unavailable";

export type LocalSuggestionRequest = {
  readonly instruction: string;
  readonly source: string;
  readonly responseSchema: Readonly<Record<string, unknown>>;
  readonly maxSourceChars?: number;
};

export type LocalSuggestion = { readonly value: unknown; readonly provenance: "on-device" };

export interface LocalSuggestionProvider {
  readonly availability: () => Promise<LocalSuggestionAvailability>;
  readonly suggest: (request: LocalSuggestionRequest) => Promise<LocalSuggestion | null>;
}

type PromptSession = {
  prompt(input: string, options: {
    readonly responseConstraint: Readonly<Record<string, unknown>>;
    readonly omitResponseConstraintInput: true;
  }): Promise<string>;
  destroy?: () => void;
};

type PromptApiOptions = {
  readonly expectedInputs: readonly [{ readonly type: "text"; readonly languages: readonly ["en"] }];
  readonly expectedOutputs: readonly [{ readonly type: "text"; readonly languages: readonly ["en"] }];
};

export type PromptApi = {
  availability(options: PromptApiOptions): Promise<string>;
  create(options: PromptApiOptions): Promise<PromptSession>;
};

const PROMPT_OPTIONS: PromptApiOptions = {
  expectedInputs: [{ type: "text", languages: ["en"] }],
  expectedOutputs: [{ type: "text", languages: ["en"] }],
};

export const DEFAULT_LOCAL_SUGGESTION_SOURCE_LIMIT = 12_000;

export function truncateLocalSuggestionSource(source: string, limit = DEFAULT_LOCAL_SUGGESTION_SOURCE_LIMIT): string {
  if (source.length <= limit) return source;
  return `${source.slice(0, limit)}\n\n[Skill source truncated]`;
}

function browserPromptApi(): PromptApi | null {
  return (globalThis as typeof globalThis & { LanguageModel?: PromptApi }).LanguageModel ?? null;
}

function isStructuredValue(value: unknown): boolean {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Uses the Prompt API only when its model is already present on the device. */
export function createPromptApiLocalSuggestionProvider(api: PromptApi | null = browserPromptApi()): LocalSuggestionProvider {
  let availabilityProbe: Promise<LocalSuggestionAvailability> | null = null;
  const availability = (): Promise<LocalSuggestionAvailability> => {
    availabilityProbe ??= api
      ? api.availability(PROMPT_OPTIONS)
          .then((state) => state === "available" ? "available" as const : "unavailable" as const)
          .catch(() => "unavailable" as const)
      : Promise.resolve("unavailable" as const);
    return availabilityProbe;
  };

  return {
    availability,
    async suggest(request) {
      if (await availability() !== "available" || api === null) return null;
      let session: PromptSession | null = null;
      try {
        session = await api.create(PROMPT_OPTIONS);
        const source = truncateLocalSuggestionSource(request.source, request.maxSourceChars);
        const output = await session.prompt(`${request.instruction}\n\n<skill>\n${source}\n</skill>`, {
          responseConstraint: request.responseSchema,
          omitResponseConstraintInput: true,
        });
        const value: unknown = JSON.parse(output);
        return isStructuredValue(value) ? { value, provenance: "on-device" } : null;
      } catch {
        return null;
      } finally {
        session?.destroy?.();
      }
    },
  };
}

/** Deterministic adapter used to drive workspace choreography in tests. */
export function createDeterministicLocalSuggestionProvider(value: unknown | null): LocalSuggestionProvider {
  return {
    availability: async () => value === null ? "unavailable" : "available",
    suggest: async () => value === null ? null : { value, provenance: "on-device" },
  };
}

export type SuggestionWithProvenance<T> = { readonly value: T; readonly provenance: "on-device" | "route" };

/** Missing, malformed, or failed local output silently uses the existing route. */
export async function suggestLocallyOrRoute<T>(options: {
  readonly provider: LocalSuggestionProvider;
  readonly request: LocalSuggestionRequest;
  readonly decode: (value: unknown) => T | null;
  readonly route: () => Promise<T>;
}): Promise<SuggestionWithProvenance<T>> {
  const local = await options.provider.suggest(options.request);
  if (local !== null) {
    const decoded = options.decode(local.value);
    if (decoded !== null) return { value: decoded, provenance: "on-device" };
  }
  return { value: await options.route(), provenance: "route" };
}
