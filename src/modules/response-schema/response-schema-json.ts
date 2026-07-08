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

/**
 * Apply an exact string replacement to the serialized document and re-parse —
 * the edit_response_schema revision path, mirroring `applySkillEdit` on the
 * skill aggregate. Fails when the target text is empty or absent, or when the
 * replacement breaks the document as JSON.
 */
export function applyResponseSchemaEdit(
  source: ResponseSchemaSource,
  oldStr: string,
  newStr: string,
): Result<ResponseSchemaSource, ResponseSchemaError> {
  if (oldStr.length === 0) {
    return err({
      tag: "edit_no_match",
      message: "Could not apply the streamed edit because the target text was empty.",
    });
  }

  const raw = serializeResponseSchema(source);
  const start = raw.indexOf(oldStr);
  if (start === -1) {
    return err({
      tag: "edit_no_match",
      message: "Could not apply the streamed edit because the target text was not found.",
    });
  }

  const nextRaw = `${raw.slice(0, start)}${newStr}${raw.slice(start + oldStr.length)}`;
  return parseResponseSchema(nextRaw);
}
