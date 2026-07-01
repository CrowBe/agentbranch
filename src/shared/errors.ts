/**
 * All domain error kinds in one closed discriminated union. `tag` is the
 * discriminant — callers switch on it exhaustively. New tags must be added here;
 * free-string tags are not permitted so the compiler catches invalid usages.
 *
 * Add a member when a genuinely new failure kind is needed. Don't add one for
 * every module — most failures map to an existing kind.
 */
export type DomainError =
  | { readonly tag: "not_configured";      readonly message: string; readonly cause?: unknown }
  | { readonly tag: "not_found";           readonly message: string; readonly cause?: unknown }
  | { readonly tag: "persistence_failed";  readonly message: string; readonly cause?: unknown }
  | { readonly tag: "auth_failed";         readonly message: string; readonly cause?: unknown }
  | { readonly tag: "model_unavailable";   readonly message: string; readonly cause?: unknown }
  | { readonly tag: "cap_reached";         readonly message: string; readonly cause?: unknown }
  | { readonly tag: "input_too_large";     readonly message: string; readonly cause?: unknown }
  | { readonly tag: "invalid_operation";   readonly message: string; readonly cause?: unknown }
  | { readonly tag: "seam_analyze_failed"; readonly message: string; readonly cause?: unknown };

/** Construct a domain error. `tag` must be one of the known kinds above. */
export function domainError(
  tag: DomainError["tag"],
  message: string,
  cause?: unknown,
): DomainError {
  return { tag, message, cause };
}

/** Raised when an adapter is asked to act but the backing service is unconfigured. */
export function notConfigured(service: string): DomainError {
  return {
    tag: "not_configured",
    message: `${service} is not configured. Add the relevant secret to .env.local.`,
  };
}
