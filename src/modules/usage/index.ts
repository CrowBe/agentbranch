/**
 * usage — token + turn meter and tier caps (ARCHITECTURE §4, §8).
 *
 * The meter is built day one: it enforces free-tier caps now and is the same
 * counter reused for PAYG metering later. Cap logic is pure and lives here;
 * persistence is a port.
 */
export type {
  Tier,
  GatedCapability,
  UsageSnapshot,
  TierLimits,
  CapDecision,
} from "./usage.types";
export { TIER_LIMITS, checkCap, applyTurn } from "./meter";
export type { UsageRepository } from "./usage.repository";
