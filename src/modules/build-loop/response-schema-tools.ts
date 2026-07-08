import { parseResponseSchema } from "@/modules/response-schema";
import type { GatewayTool } from "@/modules/model-gateway";

/**
 * The response-schema authoring tools, mirroring `write_skill`/`edit_skill`
 * (issue #151): `write_response_schema` streams the whole JSON Schema document
 * on a first draft; `edit_response_schema` applies an exact string replacement
 * on revisions. Each `handler` returns a normalised payload the loop maps to
 * `response-schema` / `response-schema-edit` events.
 */
export const responseSchemaTools: readonly GatewayTool[] = [
  {
    name: "write_response_schema",
    description:
      "Write the complete response schema (one JSON Schema document) on a first draft.",
    parameters: {
      type: "object",
      properties: {
        content: { type: "string", description: "The complete JSON Schema document." },
      },
      required: ["content"],
      additionalProperties: false,
    },
    handler: (input) => {
      const content = typeof input.content === "string" ? input.content : "";
      const parsed = parseResponseSchema(content);
      return parsed.ok
        ? { ok: true as const, content }
        : { ok: false as const, error: parsed.error.message };
    },
  },
  {
    name: "edit_response_schema",
    description:
      "Apply a targeted edit to the current response schema by replacing an exact string.",
    parameters: {
      type: "object",
      properties: {
        oldStr: { type: "string", description: "Exact text to replace." },
        newStr: { type: "string", description: "Replacement text." },
      },
      required: ["oldStr", "newStr"],
      additionalProperties: false,
    },
    handler: (input) => ({
      ok: true as const,
      oldStr: typeof input.oldStr === "string" ? input.oldStr : "",
      newStr: typeof input.newStr === "string" ? input.newStr : "",
    }),
  },
];

export type ResponseSchemaToolName = "write_response_schema" | "edit_response_schema";
