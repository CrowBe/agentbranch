import { ok, err, type Result } from "@/shared";
import type {
  ToolContractError,
  ToolContractExample,
  ToolContractIo,
  ToolContractSource,
} from "./tool-contract.types";

const KNOWN_KEYS = new Set([
  "name",
  "description",
  "input",
  "output",
  "examples",
  "failureModes",
  "safetyNotes",
]);

/**
 * Parse a raw tool-contract document (JSON text) into its source model.
 * `name` and `description` are required; `input`/`output` are an inline JSON
 * Schema or a `{ "$ref": "<response-schema title>" }` reference; unknown
 * top-level keys are preserved in `extra` so the round-trip is lossless.
 */
export function parseToolContract(raw: string): Result<ToolContractSource, ToolContractError> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return err({ tag: "invalid_json", message: "Could not parse the tool contract as JSON." });
  }
  if (!isRecord(parsed)) {
    return err({ tag: "invalid_contract", message: "A tool contract must be a JSON object." });
  }

  const { name, description, input, output, examples, failureModes, safetyNotes } = parsed;
  if (typeof name !== "string" || name.trim().length === 0) {
    return err({ tag: "invalid_contract", message: "The tool contract is missing a `name`." });
  }
  if (typeof description !== "string" || description.trim().length === 0) {
    return err({ tag: "invalid_contract", message: "The tool contract is missing a `description`." });
  }

  const parsedInput = parseIo(input, "input");
  if (!parsedInput.ok) return parsedInput;
  const parsedOutput = parseIo(output, "output");
  if (!parsedOutput.ok) return parsedOutput;
  const parsedExamples = parseExamples(examples);
  if (!parsedExamples.ok) return parsedExamples;
  const parsedFailureModes = parseStringList(failureModes, "failureModes");
  if (!parsedFailureModes.ok) return parsedFailureModes;
  const parsedSafetyNotes = parseStringList(safetyNotes, "safetyNotes");
  if (!parsedSafetyNotes.ok) return parsedSafetyNotes;

  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (!KNOWN_KEYS.has(key)) extra[key] = value;
  }

  return ok({
    name,
    description,
    input: parsedInput.value,
    output: parsedOutput.value,
    examples: parsedExamples.value,
    failureModes: parsedFailureModes.value,
    safetyNotes: parsedSafetyNotes.value,
    extra,
  });
}

/**
 * Serialize a tool-contract source back to JSON text. Inverse of
 * `parseToolContract` for any source it produced: content-lossless, stable
 * two-space formatting, optional sections omitted when empty.
 */
export function serializeToolContract(source: ToolContractSource): string {
  const document: Record<string, unknown> = {
    name: source.name,
    description: source.description,
  };
  if (source.input) document.input = serializeIo(source.input);
  if (source.output) document.output = serializeIo(source.output);
  if (source.examples.length > 0) {
    document.examples = source.examples.map((example) => ({
      input: example.input,
      ...(example.output !== undefined ? { output: example.output } : {}),
      ...(example.note !== undefined ? { note: example.note } : {}),
    }));
  }
  if (source.failureModes.length > 0) document.failureModes = source.failureModes;
  if (source.safetyNotes.length > 0) document.safetyNotes = source.safetyNotes;
  Object.assign(document, source.extra);
  return JSON.stringify(document, null, 2);
}

/**
 * Apply an exact string replacement to the serialized contract and re-parse —
 * the edit_tool_contract revision path, mirroring `applyResponseSchemaEdit`.
 * Fails when the target text is empty or absent, or when the replacement breaks
 * the document as JSON or as a valid tool contract.
 */
export function applyToolContractEdit(
  source: ToolContractSource,
  oldStr: string,
  newStr: string,
): Result<ToolContractSource, ToolContractError> {
  if (oldStr.length === 0) {
    return err({
      tag: "edit_no_match",
      message: "Could not apply the streamed edit because the target text was empty.",
    });
  }

  const raw = serializeToolContract(source);
  const start = raw.indexOf(oldStr);
  if (start === -1) {
    return err({
      tag: "edit_no_match",
      message: "Could not apply the streamed edit because the target text was not found.",
    });
  }

  const nextRaw = `${raw.slice(0, start)}${newStr}${raw.slice(start + oldStr.length)}`;
  return parseToolContract(nextRaw);
}

function parseIo(
  value: unknown,
  side: "input" | "output",
): Result<ToolContractIo | undefined, ToolContractError> {
  if (value === undefined) return ok(undefined);
  if (!isRecord(value)) {
    return err({
      tag: "invalid_contract",
      message: `The tool contract's \`${side}\` must be a JSON Schema object or a { "$ref": … } reference.`,
    });
  }
  if ("$ref" in value) {
    const ref = value.$ref;
    if (typeof ref !== "string" || ref.trim().length === 0 || Object.keys(value).length > 1) {
      return err({
        tag: "invalid_contract",
        message: `The tool contract's \`${side}\` reference must be exactly { "$ref": "<response schema title>" }.`,
      });
    }
    return ok({ kind: "schema-ref", ref: ref.trim() });
  }
  return ok({ kind: "inline", schema: value });
}

function serializeIo(io: ToolContractIo): Readonly<Record<string, unknown>> {
  return io.kind === "schema-ref" ? { $ref: io.ref } : io.schema;
}

function parseExamples(value: unknown): Result<readonly ToolContractExample[], ToolContractError> {
  if (value === undefined) return ok([]);
  if (!Array.isArray(value) || !value.every(isRecord) || !value.every((item) => "input" in item)) {
    return err({
      tag: "invalid_contract",
      message: "The tool contract's `examples` must be a list of { input, output?, note? } objects.",
    });
  }
  return ok(
    value.map((item) => ({
      input: item.input,
      ...(item.output !== undefined ? { output: item.output } : {}),
      ...(typeof item.note === "string" ? { note: item.note } : {}),
    })),
  );
}

function parseStringList(
  value: unknown,
  key: "failureModes" | "safetyNotes",
): Result<readonly string[], ToolContractError> {
  if (value === undefined) return ok([]);
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    return err({
      tag: "invalid_contract",
      message: `The tool contract's \`${key}\` must be a list of strings.`,
    });
  }
  return ok(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
