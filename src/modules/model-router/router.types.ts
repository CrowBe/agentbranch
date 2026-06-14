import type { LanguageModel } from "ai";
import type { ModelGatewayPrimitive } from "@/modules/model-gateway";
import type { Result, DomainError } from "@/shared";

/**
 * model-router — provider + model *selection* and credentials, the layer beneath
 * the model gateway (ARCHITECTURE §2 → Model router). The gateway is the single
 * *metered* entry to the model; the router is the single *selection* authority:
 * it owns the registry of providers, their credentials (server pool + optional
 * bring-your-own override), and the runtime-mutable active pick. The gateway asks
 * it for a `LanguageModel` per call and stays ignorant of which provider answered.
 *
 * Kept out of the gateway so provider/model routing can change at runtime (a
 * model console) without touching the metering mechanism.
 */

/** How a provider's `LanguageModel` is constructed by infra (AI-SDK provider seam). */
export type ProviderKind = "anthropic" | "openai-compatible";

/** A provider's stable id in the registry (e.g. `"anthropic"`, `"nous"`). */
export type ProviderId = string;

/** Model ids for each gateway primitive plus the catch-all `default`. */
export type PrimitiveModelIds = Readonly<Record<"default" | ModelGatewayPrimitive, string>>;

/**
 * A provider registered in the registry — its identity, how it is built, and the
 * model ids it defaults to. Carries no credential: keys live in the server pool
 * (config) or a bring-your-own override, never on the profile.
 */
export type ProviderProfile = {
  readonly id: ProviderId;
  readonly label: string;
  readonly kind: ProviderKind;
  /** Base URL for OpenAI-compatible providers; ignored for Anthropic. */
  readonly baseUrl?: string;
  readonly modelIds: PrimitiveModelIds;
};

/**
 * The runtime-mutable pick: which provider is active and any per-primitive model
 * overrides. Missing primitives fall back to the active profile's `modelIds`.
 */
export type ModelSelection = {
  readonly providerId: ProviderId;
  readonly modelIds?: Partial<PrimitiveModelIds>;
};

/**
 * A bring-your-own credential for a provider (tiered: the server pool is the
 * default, an override takes precedence when present). Holds a raw key — never
 * logged, never returned in a snapshot.
 */
export type CredentialOverride = {
  readonly providerId: ProviderId;
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly modelIds?: Partial<PrimitiveModelIds>;
};

/** Secret-free view of one provider for the model console. Never carries a key. */
export type ProviderStatus = {
  readonly id: ProviderId;
  readonly label: string;
  readonly kind: ProviderKind;
  readonly modelIds: PrimitiveModelIds;
  /** A server-pool key is configured for this provider. */
  readonly hasServerKey: boolean;
  /** A bring-your-own key has been supplied at runtime for this provider. */
  readonly hasByoKey: boolean;
  /** Resolvable right now — a server or bring-your-own key is present. */
  readonly ready: boolean;
};

/** Secret-free registry + active selection — the model console's view-model. */
export type RouterSnapshot = {
  readonly providers: readonly ProviderStatus[];
  readonly active: ModelSelection;
};

/** The model resolved for one gateway call, plus the facts the gateway needs. */
export type ResolvedModel = {
  readonly model: LanguageModel;
  readonly providerId: ProviderId;
  readonly kind: ProviderKind;
  readonly modelId: string;
  /** True when resolved from a bring-your-own override rather than the server pool. */
  readonly viaOverride: boolean;
};

/**
 * Provider + model selection authority. Pure *selection* mechanism — it owns the
 * registry, credentials, and the active pick, and resolves a `LanguageModel` for
 * a gateway primitive. It knows nothing about accounting or capability kinds
 * (that is the gateway + usage). Mutators return a fresh secret-free snapshot so
 * a console can re-render without a second read.
 *
 * v1 state (selection + bring-your-own credentials) is process-local; a future
 * persisted store is a clean port + adapter swap (MODULE_DESIGN §6 rule 2).
 */
export interface ModelRouter {
  /** True when the active provider can resolve a model (server or BYO key). */
  hasModel(): boolean;
  /** Secret-free registry + active selection for the model console. */
  snapshot(): RouterSnapshot;
  /** Validate + apply a new active provider/model selection. */
  setActive(selection: ModelSelection): Result<RouterSnapshot, DomainError>;
  /** Store a bring-your-own credential (server pool stays the default). */
  setCredential(credential: CredentialOverride): Result<RouterSnapshot, DomainError>;
  /** Remove a stored bring-your-own credential, falling back to the server pool. */
  clearCredential(providerId: ProviderId): Result<RouterSnapshot, DomainError>;
  /**
   * Resolve the model for a gateway primitive — the bring-your-own override when
   * one is stored for the active provider, else the server pool. Fails
   * `model_unavailable` when no key is present, `not_found` for an unknown id.
   */
  resolve(primitive: ModelGatewayPrimitive): Result<ResolvedModel, DomainError>;
}
