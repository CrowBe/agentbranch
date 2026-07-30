/**
 * import — the boundary where somebody else's work enters the product.
 *
 * It owns the **import ladder** (ARCHITECTURE §10): the three rungs of
 * increasing complexity a user can arrive at, from one building block to a
 * whole agent configuration. The pure classifier here answers "what is this
 * document?" for the two lower rungs; the agent-configuration rung is an
 * analysis capability of its own (`agent-configuration-import`).
 */
export {
  IMPORT_TIERS,
  type ImportTier,
  type ImportTierDescriptor,
  type ImportPrimitiveKind,
  type ImportClassification,
  type SkillImportFetcher,
  type SkillImportFetchError,
} from "./import.types";
export { classifyImportDocument, readableKind } from "./classify";
