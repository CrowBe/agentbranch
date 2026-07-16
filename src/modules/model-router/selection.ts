import { ok, err, domainError, type Result, type DomainError } from "@/shared";
import type {
  ModelSelection,
  PrimitiveModelIds,
  ProviderId,
  ProviderProfile,
  StructuredOutputSupport,
} from "./router.types";
import type { ModelGatewayPrimitive } from "@/modules/model-gateway";

/** The model-id keys, in resolution order — `default` is the catch-all. */
const MODEL_ID_KEYS = [
  "default",
  "classify",
  "runAgent",
  "streamAgent",
  "generate",
] as const satisfies ReadonlyArray<"default" | ModelGatewayPrimitive>;

/** Find a registered profile by id, or `undefined`. Pure registry lookup. */
export function findProfile(
  profiles: readonly ProviderProfile[],
  id: ProviderId,
): ProviderProfile | undefined {
  return profiles.find((profile) => profile.id === id);
}

/** Resolve a profile's structured-output mode, defaulting by provider kind. */
export function structuredOutputSupportFor(profile: ProviderProfile): StructuredOutputSupport {
  return profile.structuredOutputs ?? (profile.kind === "anthropic" ? "json-schema" : "json");
}

/**
 * The default active selection: the preferred provider when it is registered,
 * else the first registered provider. The router needs a valid pick on boot even
 * before anything is configured.
 */
export function defaultSelection(
  profiles: readonly ProviderProfile[],
  preferredId?: ProviderId,
): ModelSelection {
  const preferred = preferredId ? findProfile(profiles, preferredId) : undefined;
  const chosen = preferred ?? profiles[0];
  return { providerId: chosen ? chosen.id : (preferredId ?? "") };
}

/**
 * Validate a selection against the registry: the provider must exist and any
 * model-id overrides must be non-empty strings. Returns the (trimmed) selection
 * or a `not_found` / `not_configured` DomainError the console surfaces verbatim.
 */
export function validateSelection(
  selection: ModelSelection,
  profiles: readonly ProviderProfile[],
): Result<ModelSelection, DomainError> {
  if (!findProfile(profiles, selection.providerId)) {
    return err(domainError("not_found", `Unknown model provider: "${selection.providerId}".`));
  }
  if (selection.modelIds) {
    for (const [key, value] of Object.entries(selection.modelIds)) {
      if (value !== undefined && value.trim().length === 0) {
        return err(domainError("not_configured", `Model id for "${key}" cannot be empty.`));
      }
    }
  }
  return ok(selection);
}

/**
 * Resolve the effective model ids for a provider: a per-primitive override from
 * the active selection wins, then a bring-your-own override, then the profile's
 * own ids; any gap falls back to the profile's `default`. Pure — the gateway
 * uses this to know which model id each primitive routes to (also drives effort).
 */
export function effectiveModelIds(
  profile: ProviderProfile,
  selection: ModelSelection | undefined,
  override?: { readonly modelIds?: Partial<PrimitiveModelIds> },
): PrimitiveModelIds {
  const selectionIds = selection?.providerId === profile.id ? selection.modelIds : undefined;
  const entries = MODEL_ID_KEYS.map((key) => {
    const picked =
      selectionIds?.[key] ??
      override?.modelIds?.[key] ??
      profile.modelIds[key] ??
      profile.modelIds.default;
    return [key, picked] as const;
  });
  return Object.fromEntries(entries) as PrimitiveModelIds;
}
