import type { Result, UserId, DomainError } from "@/shared";

/** A signed-in identity, sourced from OAuth (Google/GitHub) via Clerk. */
export type AuthIdentity = {
  readonly userId: UserId;
  readonly email: string;
};

/**
 * Identity port. The domain depends on this interface; infra supplies a Clerk
 * adapter (real) and a stub adapter (offline). Keeping auth behind a port means
 * the build loop and route handlers are testable without Clerk in the room.
 */
export interface AuthPort {
  /** The current request's identity, or null when signed out. */
  currentIdentity(): Promise<Result<AuthIdentity | null, DomainError>>;
}
