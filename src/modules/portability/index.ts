/**
 * portability — the one engine behind cross-provider validation and
 * cross-primitive export (ARCHITECTURE §9). Both surfaces deferred; the engine
 * is designed and stubbed so its two callers share one contract.
 */
export type {
  PortabilityProvider,
  TransformedSkill,
} from "./portability.types";
export { transformSkill } from "./portability-transform";
