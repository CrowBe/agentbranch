/**
 * Offline structural validation against the JSON Schema subset the primitives
 * use: `type`, `enum`, `const`, `properties`, `required`,
 * `additionalProperties: false`, and `items`. Deterministic, zero tokens —
 * the validation half of the response-schema primitive that tool-contract
 * example checks and the relational test run compose (ARCHITECTURE §9.2).
 * Keywords outside the subset are preserved by the source model but not
 * enforced here.
 */
export function validateAgainstSchema(
  value: unknown,
  schema: Readonly<Record<string, unknown>>,
  path = "value",
): readonly string[] {
  const issues: string[] = [];

  const type = schemaType(schema);
  if (type !== null && !matchesType(value, type)) {
    issues.push(`${path} should be ${describeType(type)}, got ${typeName(value)}.`);
    return issues;
  }

  if (Array.isArray(schema.enum) && !schema.enum.some((option) => deepEquals(option, value))) {
    issues.push(`${path} is not one of the allowed values.`);
  }
  if ("const" in schema && !deepEquals(schema.const, value)) {
    issues.push(`${path} does not equal the required constant.`);
  }

  if (isRecord(value)) {
    const properties = isRecord(schema.properties) ? schema.properties : {};
    const required = Array.isArray(schema.required)
      ? schema.required.filter((name): name is string => typeof name === "string")
      : [];

    for (const name of required) {
      if (!(name in value)) issues.push(`${path} is missing required property \`${name}\`.`);
    }
    for (const [name, child] of Object.entries(value)) {
      const childSchema = properties[name];
      if (isRecord(childSchema)) {
        issues.push(...validateAgainstSchema(child, childSchema, `${path}.${name}`));
      } else if (schema.additionalProperties === false && !(name in properties)) {
        issues.push(`${path} has unexpected property \`${name}\`.`);
      }
    }
  }

  if (Array.isArray(value) && isRecord(schema.items)) {
    const items = schema.items;
    value.forEach((item, index) => {
      issues.push(...validateAgainstSchema(item, items, `${path}[${index}]`));
    });
  }

  return issues;
}

/**
 * A deterministic example value conforming to the schema's structural subset —
 * how a contract-driven mock tool answers when the author gave no example
 * output: author-declared `examples` / `default` / `const` / `enum` win, then
 * a per-type placeholder. Offline, no model call.
 */
export function exampleValueForSchema(
  schema: Readonly<Record<string, unknown>>,
  depth = 0,
): unknown {
  if (Array.isArray(schema.examples) && schema.examples.length > 0) return schema.examples[0];
  if ("default" in schema) return schema.default;
  if ("const" in schema) return schema.const;
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0];

  const type = schemaType(schema);
  const first = Array.isArray(type) ? type[0] : type;
  if (depth > 6) return null;

  switch (first) {
    case "object": {
      const properties = isRecord(schema.properties) ? schema.properties : {};
      const value: Record<string, unknown> = {};
      for (const [name, child] of Object.entries(properties)) {
        if (isRecord(child)) value[name] = exampleValueForSchema(child, depth + 1);
      }
      return value;
    }
    case "array":
      return isRecord(schema.items) ? [exampleValueForSchema(schema.items, depth + 1)] : [];
    case "string":
      return "example";
    case "number":
    case "integer":
      return 0;
    case "boolean":
      return true;
    case "null":
      return null;
    default:
      // No type declared: an object shape if properties exist, else a string.
      return isRecord(schema.properties)
        ? exampleValueForSchema({ ...schema, type: "object" }, depth)
        : "example";
  }
}

export const JSON_SCHEMA_TYPES = [
  "object",
  "array",
  "string",
  "number",
  "integer",
  "boolean",
  "null",
] as const;

export type JsonSchemaType = (typeof JSON_SCHEMA_TYPES)[number];

/** The schema's declared `type`(s), or null when it declares none. */
export function schemaType(
  schema: Readonly<Record<string, unknown>>,
): JsonSchemaType | readonly JsonSchemaType[] | null {
  const declared = schema.type;
  if (typeof declared === "string") {
    return isJsonSchemaType(declared) ? declared : null;
  }
  if (Array.isArray(declared)) {
    const types = declared.filter(isJsonSchemaType);
    return types.length > 0 ? types : null;
  }
  return null;
}

export function isJsonSchemaType(value: unknown): value is JsonSchemaType {
  return typeof value === "string" && (JSON_SCHEMA_TYPES as readonly string[]).includes(value);
}

function matchesType(
  value: unknown,
  type: JsonSchemaType | readonly JsonSchemaType[],
): boolean {
  const types = Array.isArray(type) ? type : [type];
  return types.some((t) => {
    switch (t) {
      case "object":
        return isRecord(value);
      case "array":
        return Array.isArray(value);
      case "string":
        return typeof value === "string";
      case "number":
        return typeof value === "number";
      case "integer":
        return typeof value === "number" && Number.isInteger(value);
      case "boolean":
        return typeof value === "boolean";
      case "null":
        return value === null;
    }
  });
}

function describeType(type: JsonSchemaType | readonly JsonSchemaType[]): string {
  return Array.isArray(type) ? type.join(" | ") : String(type);
}

function typeName(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function deepEquals(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
