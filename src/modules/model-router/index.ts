/**
 * model-router — the platform's provider + model *selection* authority, the
 * layer beneath the model gateway (ARCHITECTURE §2 → Model router; §4 routing
 * decision). Owns the provider registry, credentials (server pool + optional
 * bring-your-own override), and the runtime-mutable active selection; resolves a
 * `LanguageModel` for a gateway primitive. Pure selection mechanism — it knows
 * nothing about accounting or capability kinds.
 *
 * The `ModelRouter` port lives here; the concrete adapter (which constructs the
 * AI-SDK providers and holds runtime state) lives in `infra/ai` and is wired in
 * `container.ts`. Only the model gateway and the model-console route consume it.
 */
export type {
  ProviderKind,
  StructuredOutputSupport,
  ProviderId,
  PrimitiveModelIds,
  ProviderProfile,
  ModelSelection,
  CredentialOverride,
  ProviderStatus,
  RouterSnapshot,
  ResolvedModel,
  ModelRouter,
} from "./router.types";
export {
  findProfile,
  defaultSelection,
  validateSelection,
  effectiveModelIds,
  structuredOutputSupportFor,
} from "./selection";
