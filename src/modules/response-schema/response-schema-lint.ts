import { summarizeLintFindings, type LintFinding } from "@/modules/lint";
import type { Analyzer } from "@/modules/skill-analysis";
import { ok } from "@/shared";
import { schemaType } from "./schema-validate";
import type { ResponseSchemaLintReport, ResponseSchemaSource } from "./response-schema.types";

const DESCRIPTION_MIN = 12;
const NESTING_DEPTH_WARN = 6;

export const RESPONSE_SCHEMA_LINT_RULESET_VERSION = {
  descriptionMin: DESCRIPTION_MIN,
  nestingDepthWarn: NESTING_DEPTH_WARN,
} as const;

/**
 * The response-schema quality analyzer — pure text-only rules, zero tokens,
 * runs offline (MODULE_DESIGN §6 rule 1). Structural validity, required
 * fields, and the common smells that make a structured output unreliable for
 * an agent to produce or a consumer to trust.
 */
export const responseSchemaLintAnalyzer: Analyzer<ResponseSchemaSource, ResponseSchemaLintReport> = {
  kind: "response-schema-lint",
  async analyze(source: ResponseSchemaSource) {
    return ok(createResponseSchemaLintReport(source));
  },
};

export function createResponseSchemaLintReport(
  source: ResponseSchemaSource,
): ResponseSchemaLintReport {
  const findings: LintFinding[] = [];
  const document = source.document;

  if (typeof document.title !== "string" || document.title.trim().length === 0) {
    findings.push({
      rule: "schema.title.missing",
      severity: "warn",
      message:
        "The schema has no `title`. Name it so tool contracts and evaluations can reference it.",
    });
  }
  if (typeof document.description !== "string" || document.description.trim().length === 0) {
    findings.push({
      rule: "schema.description.missing",
      severity: "warn",
      message:
        "The schema has no `description`. Say what the structured output represents so agents fill it correctly.",
    });
  } else if (document.description.trim().length < DESCRIPTION_MIN) {
    findings.push({
      rule: "schema.description.too-short",
      severity: "info",
      message: "The schema description is very short. Add what the output is for.",
    });
  }

  findings.push(...schemaShapeFindings(document, "schema"));

  return { kind: "response-schema-lint", source, summary: summarizeLintFindings(findings), findings };
}

/**
 * Structural findings for one JSON-Schema node and everything under it.
 * Exported so the tool-contract analyzer runs the same rules over its inline
 * input/output schemas — the two primitives share one schema-quality
 * vocabulary (ARCHITECTURE §9.2).
 */
export function schemaShapeFindings(
  schema: Readonly<Record<string, unknown>>,
  path: string,
  depth = 0,
): LintFinding[] {
  const findings: LintFinding[] = [];

  if (depth > NESTING_DEPTH_WARN) {
    findings.push({
      rule: "schema.structure.deep-nesting",
      severity: "info",
      message: `\`${path}\` nests deeper than ${NESTING_DEPTH_WARN} levels. Flatten the shape so agents can produce it reliably.`,
    });
    return findings;
  }

  const declaredType = schema.type;
  const type = schemaType(schema);
  if (declaredType !== undefined && type === null) {
    const shown = Array.isArray(declaredType) ? declaredType.join(", ") : String(declaredType);
    findings.push({
      rule: "schema.type.invalid",
      severity: "error",
      message: `\`${path}\` declares type \`${shown}\`, which is not a JSON Schema type.`,
    });
  }
  if (declaredType === undefined && !hasOtherShapeKeywords(schema)) {
    findings.push({
      rule: "schema.type.missing",
      severity: "warn",
      message: `\`${path}\` declares no \`type\` (and no enum/const/properties). Untyped output cannot be validated.`,
    });
  }

  if (Array.isArray(schema.enum) && schema.enum.length === 0) {
    findings.push({
      rule: "schema.enum.empty",
      severity: "error",
      message: `\`${path}\` has an empty \`enum\` — no value can ever satisfy it.`,
    });
  }

  const isObject = type === "object" || (type === null && isRecord(schema.properties));
  if (isObject) {
    const properties = isRecord(schema.properties) ? schema.properties : {};
    const propertyNames = Object.keys(properties);

    if (propertyNames.length === 0) {
      findings.push({
        rule: "schema.object.no-properties",
        severity: "warn",
        message: `\`${path}\` is an object with no \`properties\` — the output shape is unconstrained.`,
      });
    } else {
      if (!Array.isArray(schema.required) || schema.required.length === 0) {
        findings.push({
          rule: "schema.required.missing",
          severity: "warn",
          scorePenalty: 15,
          message: `\`${path}\` marks no properties \`required\`, so an empty object would validate.`,
        });
      }
      if (schema.additionalProperties !== false) {
        findings.push({
          rule: "schema.object.open",
          severity: "warn",
          scorePenalty: 15,
          message: `\`${path}\` allows undeclared properties. Set \`additionalProperties: false\` to keep the output bounded.`,
        });
      }
      const undescribed = propertyNames.filter((name) => {
        const child = properties[name];
        return (
          isRecord(child) &&
          (typeof child.description !== "string" || child.description.trim().length === 0)
        );
      });
      if (undescribed.length > 0) {
        findings.push({
          rule: "schema.property.description-missing",
          severity: "info",
          scorePenalty: Math.ceil((undescribed.length / propertyNames.length) * 3),
          message: `\`${path}\` has ${undescribed.length === 1 ? "a property" : `${undescribed.length} properties`} without a description (\`${undescribed[0]}\`${undescribed.length > 1 ? ", …" : ""}). Describe each field so agents fill it correctly.`,
        });
      }
    }

    if (Array.isArray(schema.required)) {
      for (const name of schema.required) {
        if (typeof name !== "string" || name in properties) continue;
        findings.push({
          rule: "schema.required.unknown-property",
          severity: "error",
          message: `\`${path}\` requires \`${String(name)}\`, but no such property is declared.`,
        });
      }
    }

    for (const [name, child] of Object.entries(properties)) {
      if (isRecord(child)) {
        findings.push(...schemaShapeFindings(child, `${path}.${name}`, depth + 1));
      }
    }
  }

  if (type === "array") {
    if (!isRecord(schema.items)) {
      findings.push({
        rule: "schema.array.items-missing",
        severity: "warn",
        message: `\`${path}\` is an array without \`items\` — element shape is unconstrained.`,
      });
    } else {
      findings.push(...schemaShapeFindings(schema.items, `${path}[]`, depth + 1));
    }
  }

  return findings;
}

/** Keywords that constrain a value even without an explicit `type`. */
function hasOtherShapeKeywords(schema: Readonly<Record<string, unknown>>): boolean {
  return (
    "enum" in schema ||
    "const" in schema ||
    "$ref" in schema ||
    isRecord(schema.properties) ||
    ["allOf", "anyOf", "oneOf"].some((keyword) => Array.isArray(schema[keyword]))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
