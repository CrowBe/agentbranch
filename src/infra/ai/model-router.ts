import {
  defaultSelection,
  effectiveModelIds,
  findProfile,
  structuredOutputSupportFor,
  validateSelection,
  type CredentialOverride,
  type ModelRouter,
  type ModelSelection,
  type PrimitiveModelIds,
  type ProviderId,
  type ProviderProfile,
  type ProviderStatus,
  type ResolvedModel,
  type RouterSnapshot,
} from "@/modules/model-router";
import type { ModelProvider, ModelGatewayPrimitive } from "@/modules/model-gateway";
import { pricesForModel } from "@/modules/usage";
import { ok, err, domainError, isErr, type Result, type DomainError } from "@/shared";
import { createAnthropicProvider } from "./anthropic-provider";
import { createNousProvider } from "./nous-provider";

/** A server-pool credential for a provider (read from config; never client-supplied). */
export type ServerKey = { readonly apiKey?: string; readonly baseUrl?: string };

/**
 * The model router adapter — the platform's provider/model selection authority
 * (CONTEXT.md → Model router). It holds the registry, the server-pool keys, and
 * the runtime-mutable state (active selection + bring-your-own overrides), and
 * builds AI-SDK providers on demand. The model gateway consumes it for a
 * `LanguageModel` per call; the model-console route drives its mutators.
 *
 * State is process-local in v1: the active pick and any bring-your-own keys live
 * in memory, so a console change is immediate but not shared across instances or
 * persisted (a future persisted store is a clean port + adapter swap). Keys are
 * never logged and never leave through `snapshot()` — only booleans do.
 */
export function createModelRouter(deps: {
  profiles: readonly ProviderProfile[];
  serverKeys: Readonly<Partial<Record<ProviderId, ServerKey>>>;
  defaultSelection?: ModelSelection;
  cliAvailable?: (kind: "claude-code-cli" | "codex-cli") => boolean;
  modelPriced?: (modelId: string) => boolean;
}): ModelRouter {
  const { profiles, serverKeys } = deps;
  let active: ModelSelection = deps.defaultSelection ?? defaultSelection(profiles);
  const overrides = new Map<ProviderId, CredentialOverride>();
  // Cache built providers; keyed by provider + key-source + model ids so a
  // credential or model change rebuilds rather than serves a stale model.
  const cache = new Map<string, ModelProvider>();
  const modelPriced = deps.modelPriced ?? ((modelId: string) => pricesForModel(modelId) !== null);

  function serverKeyFor(id: ProviderId): ServerKey {
    return serverKeys[id] ?? {};
  }

  function hasRuntime(profile: ProviderProfile): boolean {
    if (profile.kind === "claude-code-cli" || profile.kind === "codex-cli") {
      return deps.cliAvailable?.(profile.kind) ?? false;
    }
    return Boolean(overrides.get(profile.id)?.apiKey ?? serverKeyFor(profile.id).apiKey);
  }

  function hasPricedModels(profile: ProviderProfile, selection = active): boolean {
    return Object.values(effectiveModelIds(profile, selection)).every(modelPriced);
  }

  function isReady(profile: ProviderProfile): boolean {
    return hasRuntime(profile) && hasPricedModels(profile);
  }

  function buildProvider(
    profile: ProviderProfile,
    apiKey: string,
    baseUrl: string | undefined,
    modelIds: PrimitiveModelIds,
  ): ModelProvider {
    if (profile.kind === "anthropic") {
      return createAnthropicProvider({ apiKey, modelIds });
    }
    if (profile.kind === "openai-compatible") return createNousProvider({
      apiKey,
      modelIds,
      baseUrl,
      structuredOutputs: structuredOutputSupportFor(profile),
    });
    throw new Error(`CLI provider "${profile.id}" cannot be built as an SDK provider.`);
  }

  function providerFor(
    profile: ProviderProfile,
    override: CredentialOverride | undefined,
    modelIds: PrimitiveModelIds,
  ): ModelProvider {
    const apiKey = override?.apiKey ?? serverKeyFor(profile.id).apiKey ?? "";
    const baseUrl = override?.baseUrl ?? serverKeyFor(profile.id).baseUrl ?? profile.baseUrl;
    const cacheKey = [
      profile.id,
      override ? "byo" : "server",
      modelIds.default,
      modelIds.classify,
      modelIds.runAgent,
      modelIds.streamAgent,
      modelIds.generate,
      structuredOutputSupportFor(profile),
    ].join("|");
    const cached = cache.get(cacheKey);
    if (cached) return cached;
    const built = buildProvider(profile, apiKey, baseUrl, modelIds);
    cache.set(cacheKey, built);
    return built;
  }

  /** Drop cached providers for one id so a credential change can't serve a stale model. */
  function invalidate(id: ProviderId): void {
    for (const key of cache.keys()) {
      if (key.startsWith(`${id}|`)) cache.delete(key);
    }
  }

  function status(profile: ProviderProfile): ProviderStatus {
    const hasServerKey = Boolean(serverKeyFor(profile.id).apiKey);
    const hasByoKey = overrides.has(profile.id);
    const cliReady =
      (profile.kind === "claude-code-cli" || profile.kind === "codex-cli") && hasRuntime(profile);
    const hasPricing = hasPricedModels(profile);
    const runtimeReady = cliReady || hasServerKey || hasByoKey;
    return {
      id: profile.id,
      label: profile.label,
      kind: profile.kind,
      structuredOutputs: structuredOutputSupportFor(profile),
      modelIds: effectiveModelIds(profile, active),
      hasServerKey,
      hasByoKey,
      readiness: runtimeReady && !hasPricing
        ? "unpriced"
        : cliReady
          ? "cli-detected"
          : hasByoKey
            ? "byo-key"
            : hasServerKey
              ? "server-key"
              : "unavailable",
      ready: runtimeReady && hasPricing,
    };
  }

  function snapshot(): RouterSnapshot {
    return { providers: profiles.map(status), active };
  }

  return {
    hasModel() {
      const profile = findProfile(profiles, active.providerId);
      return profile ? isReady(profile) : false;
    },

    snapshot,

    setActive(selection): Result<RouterSnapshot, DomainError> {
      const validated = validateSelection(selection, profiles);
      if (isErr(validated)) return validated;
      active = validated.value;
      return ok(snapshot());
    },

    setCredential(credential): Result<RouterSnapshot, DomainError> {
      if (!findProfile(profiles, credential.providerId)) {
        return err(domainError("not_found", `Unknown model provider: "${credential.providerId}".`));
      }
      if (credential.apiKey.trim().length === 0) {
        return err(domainError("not_configured", "An API key is required."));
      }
      overrides.set(credential.providerId, credential);
      invalidate(credential.providerId);
      return ok(snapshot());
    },

    clearCredential(providerId): Result<RouterSnapshot, DomainError> {
      overrides.delete(providerId);
      invalidate(providerId);
      return ok(snapshot());
    },

    resolve(
      primitive: ModelGatewayPrimitive,
      selection?: ModelSelection,
    ): Result<ResolvedModel, DomainError> {
      const requested = selection ? validateSelection(selection, profiles) : ok(active);
      if (isErr(requested)) return requested;
      const profile = findProfile(profiles, requested.value.providerId);
      if (!profile) {
        return err(
          domainError("not_found", `Unknown model provider: "${requested.value.providerId}".`),
        );
      }
      const override = overrides.get(profile.id);
      if (profile.kind === "claude-code-cli" || profile.kind === "codex-cli") {
        if (!hasRuntime(profile)) {
          return err(domainError("model_unavailable", `${profile.label} CLI was not detected.`));
        }
        const modelIds = effectiveModelIds(profile, requested.value);
        if (!modelPriced(modelIds[primitive])) {
          return err(domainError("model_unavailable", `No quota price is configured for model "${modelIds[primitive]}".`));
        }
        return ok({
          providerId: profile.id,
          kind: profile.kind,
          structuredOutputs: structuredOutputSupportFor(profile),
          modelId: modelIds[primitive],
          viaOverride: false,
        });
      }
      const apiKey = override?.apiKey ?? serverKeyFor(profile.id).apiKey;
      if (!apiKey) {
        return err(
          domainError(
            "model_unavailable",
            `No API key for "${profile.label}". Add one in the model console or .env.local.`,
          ),
        );
      }
      const modelIds = effectiveModelIds(profile, requested.value, override);
      if (!modelPriced(modelIds[primitive])) {
        return err(domainError("model_unavailable", `No quota price is configured for model "${modelIds[primitive]}".`));
      }
      const provider = providerFor(profile, override, modelIds);
      const model = provider.models?.[primitive] ?? provider.model;
      if (!model) {
        return err(domainError("model_unavailable", `No model resolved for "${profile.label}".`));
      }
      return ok({
        model,
        providerId: profile.id,
        kind: profile.kind,
        structuredOutputs: structuredOutputSupportFor(profile),
        modelId: modelIds[primitive],
        viaOverride: Boolean(override),
      });
    },
  };
}
