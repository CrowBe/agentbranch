/**
 * portability — cross-runtime validation for skills (ARCHITECTURE §9).
 * The engine checks triggering behaviour on selected runtime targets through
 * the model gateway; it does not claim format conversion or full runtime
 * fidelity.
 */
export type {
  RuntimeTarget,
  RuntimeTargetResult,
  CrossRuntimeValidationInput,
  CrossRuntimeValidationResult,
  CrossRuntimeValidationBreakdown,
} from "./portability.types";
export { portabilityCapability, runCrossRuntimeValidation } from "./portability-transform";
