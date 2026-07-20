/**
 * response-schema — the first equipment primitive beyond Skill: a structured
 * output definition (a JSON Schema document) with a lossless source model and
 * pure, offline lint (ARCHITECTURE §9.2, primitive 1).
 *
 * Analysis-only in v1 — no evaluator, no runtime orchestration. Its schema
 * subset also powers composition: tool contracts reference response schemas
 * for their I/O shapes, and the relational test run validates tool-call
 * arguments and mock outputs with `validateAgainstSchema` /
 * `exampleValueForSchema`.
 */
import { defineCapability } from "@/modules/skill-analysis";
import { responseSchemaLintAnalyzer } from "./response-schema-lint";
import { responseSchemaBreakdownRenderer, responseSchemaInsightsRenderer, responseSchemaRenderedRenderer, responseSchemaSourceRenderer } from "./renderers";

export const responseSchemaCapability = defineCapability({
  name: "response schema quality",
  analyzer: responseSchemaLintAnalyzer,
  renderers: {
    insights: responseSchemaInsightsRenderer,
    breakdown: responseSchemaBreakdownRenderer,
    rendered: responseSchemaRenderedRenderer,
    source: responseSchemaSourceRenderer,
  },
});

export {
  applyResponseSchemaEdit,
  parseResponseSchema,
  serializeResponseSchema,
  responseSchemaName,
} from "./response-schema-json";
export {
  createResponseSchemaLintReport,
  responseSchemaLintAnalyzer,
  schemaShapeFindings,
  RESPONSE_SCHEMA_LINT_RULESET_VERSION,
} from "./response-schema-lint";
export {
  exampleValueForSchema,
  isJsonSchemaType,
  schemaType,
  validateAgainstSchema,
  JSON_SCHEMA_TYPES,
} from "./schema-validate";
export type { JsonSchemaType } from "./schema-validate";
export { responseSchemaBreakdownRenderer, responseSchemaInsightsRenderer, responseSchemaRenderedRenderer, responseSchemaSourceRenderer } from "./renderers";
export type {
  ResponseSchemaError,
  ResponseSchemaLintReport,
  ResponseSchemaSource,
} from "./response-schema.types";
