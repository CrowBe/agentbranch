import type { DomainError } from "@/shared";

/**
 * Map a DomainError onto the HTTP status its tag deserves. The one place the
 * closed error union meets status codes — route handlers and server drivers
 * share it so a tag always answers with the same shape.
 */
export function domainErrorResponse(error: DomainError): Response {
  const status =
    error.tag === "cap_reached"
      ? 429
      : error.tag === "model_unavailable" || error.tag === "not_configured"
        ? 503
        : error.tag === "not_found"
          ? 404
          : error.tag === "auth_failed"
            ? 401
            : error.tag === "invalid_operation"
              ? 409
              : 500;

  return Response.json({ error: error.message, code: error.tag }, { status });
}
