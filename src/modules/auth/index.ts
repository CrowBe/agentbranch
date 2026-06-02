/**
 * auth — identity as a port (ARCHITECTURE §4 stack, §8 OAuth-only).
 *
 * OAuth-only (Google + GitHub): no passwords, no password-storage liability.
 * The port keeps the rest of the app independent of Clerk.
 */
export type { AuthIdentity, AuthPort } from "./auth.types";
