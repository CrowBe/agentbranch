// Shared kernel — cross-cutting primitives with no domain knowledge.
// Domain modules may depend on this; it depends on nothing of ours.
export * from "./result";
export * from "./id";
export * from "./errors";
export * from "./canonical-json";
export * from "./sse";
export * from "./limits";
export * from "./binomial-statistics";
