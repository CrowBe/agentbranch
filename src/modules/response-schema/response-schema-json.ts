import { ok, err, type Result } from "@/shared";
import type { ResponseSchemaError, ResponseSchemaSource } from "./response-schema.types";

/**
 * Parse a raw response-schema document (JSON text) into its source model.
 * The whole document is kept, so nothing an author wrote is dropped —
 * `serializeResponseSchema` reproduces every key and value.
 */
export function parseResponseSchema(raw: string): Result<ResponseSchemaSource, ResponseSchemaError> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return err({ tag: "invalid_json", message: "Could not parse the response schema as JSON." });
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return err({
      tag: "not_an_object",
      message: "A response schema must be a JSON object (a JSON Schema document).",
    });
  }
  return ok({ document: parsed as Record<string, unknown> });
}

/**
 * Serialize a response-schema source back to JSON text. Inverse of
 * `parseResponseSchema` for any source it produced: content-lossless (every
 * key/value round-trips), with stable two-space formatting.
 */
export function serializeResponseSchema(source: ResponseSchemaSource): string {
  return JSON.stringify(source.document, null, 2);
}

/** The schema's display name — its JSON Schema `title`, when the author set one. */
export function responseSchemaName(source: ResponseSchemaSource): string {
  const title = source.document.title;
  return typeof title === "string" ? title.trim() : "";
}
