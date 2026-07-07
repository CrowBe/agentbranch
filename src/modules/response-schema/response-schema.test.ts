import { describe, it, expect } from "vitest";
import { runCapability } from "@/modules/skill-analysis";
import { unwrap, isErr } from "@/shared";
import {
  createResponseSchemaLintReport,
  exampleValueForSchema,
  parseResponseSchema,
  responseSchemaCapability,
  responseSchemaName,
  serializeResponseSchema,
  validateAgainstSchema,
} from "./index";

const INVOICE_SCHEMA = {
  title: "invoice-summary",
  description: "The structured summary a billing skill returns for one invoice.",
  type: "object",
  additionalProperties: false,
  required: ["invoiceId", "amount"],
  properties: {
    invoiceId: { type: "string", description: "The vendor's invoice identifier." },
    amount: { type: "number", description: "Total due in cents." },
    overdue: { type: "boolean", description: "True when past the due date." },
  },
} as const;

describe("response-schema source model", () => {
  it("round-trips a document losslessly, preserving every key", () => {
    const raw = JSON.stringify({ ...INVOICE_SCHEMA, "x-vendor": { custom: [1, 2] } });
    const source = unwrap(parseResponseSchema(raw));
    const reparsed = unwrap(parseResponseSchema(serializeResponseSchema(source)));
    expect(reparsed.document).toEqual(source.document);
    expect(reparsed.document["x-vendor"]).toEqual({ custom: [1, 2] });
    expect(responseSchemaName(source)).toBe("invoice-summary");
  });

  it("rejects non-JSON and non-object documents", () => {
    expect(isErr(parseResponseSchema("{nope"))).toBe(true);
    const list = parseResponseSchema("[1,2]");
    expect(isErr(list) && list.error.tag === "not_an_object").toBe(true);
  });
});

describe("response-schema lint", () => {
  it("passes a well-formed schema without errors", () => {
    const report = createResponseSchemaLintReport(unwrap(parseResponseSchema(JSON.stringify(INVOICE_SCHEMA))));
    expect(report.kind).toBe("response-schema-lint");
    expect(report.summary.counts.error).toBe(0);
    expect(report.findings.map((f) => f.rule)).not.toContain("schema.title.missing");
  });

  it("flags missing naming, invalid types, and required/property drift", () => {
    const report = createResponseSchemaLintReport(
      unwrap(
        parseResponseSchema(
          JSON.stringify({
            type: "recordset",
            required: ["ghost"],
            properties: { real: { type: "string" } },
          }),
        ),
      ),
    );
    const rules = report.findings.map((f) => f.rule);
    expect(rules).toContain("schema.title.missing");
    expect(rules).toContain("schema.description.missing");
    expect(rules).toContain("schema.type.invalid");
    expect(rules).toContain("schema.required.unknown-property");
    expect(report.summary.counts.error).toBeGreaterThan(0);
  });

  it("flags unbounded shapes and recurses into nested schemas", () => {
    const report = createResponseSchemaLintReport(
      unwrap(
        parseResponseSchema(
          JSON.stringify({
            title: "t",
            description: "A nested structure used by tests.",
            type: "object",
            properties: {
              rows: { type: "array" },
              child: { type: "object", properties: {} },
            },
          }),
        ),
      ),
    );
    const rules = report.findings.map((f) => f.rule);
    expect(rules).toContain("schema.object.open");
    expect(rules).toContain("schema.array.items-missing");
    expect(rules).toContain("schema.object.no-properties");
  });

  it("renders through the seam to insights and breakdown", async () => {
    const source = unwrap(parseResponseSchema(JSON.stringify(INVOICE_SCHEMA)));
    const insights = unwrap(await runCapability(responseSchemaCapability, "insights", source));
    expect(insights.grade).toBeDefined();
    expect(insights.summary).toContain("response schema");
    const breakdown = unwrap(await runCapability(responseSchemaCapability, "breakdown", source));
    expect(breakdown.summary.counts).toBeDefined();
  });
});

describe("validateAgainstSchema", () => {
  it("accepts a conforming value", () => {
    expect(
      validateAgainstSchema({ invoiceId: "INV-1", amount: 4200, overdue: false }, INVOICE_SCHEMA),
    ).toEqual([]);
  });

  it("reports type, required, enum, and unexpected-property issues with paths", () => {
    const issues = validateAgainstSchema(
      { amount: "a lot", extra: true },
      INVOICE_SCHEMA,
      "call",
    );
    expect(issues.join("\n")).toContain("call is missing required property `invoiceId`");
    expect(issues.join("\n")).toContain("call.amount should be number");
    expect(issues.join("\n")).toContain("unexpected property `extra`");

    expect(
      validateAgainstSchema("archive", { type: "string", enum: ["respond", "escalate"] }),
    ).toEqual(["value is not one of the allowed values."]);
  });

  it("validates array items", () => {
    const issues = validateAgainstSchema([{ ok: 1 }], {
      type: "array",
      items: { type: "object", properties: { ok: { type: "boolean" } } },
    });
    expect(issues[0]).toContain("value[0].ok should be boolean");
  });
});

describe("exampleValueForSchema", () => {
  it("prefers author-declared examples, then builds per-type placeholders", () => {
    expect(exampleValueForSchema({ type: "string", examples: ["seed"] })).toBe("seed");
    expect(exampleValueForSchema({ type: "string", enum: ["respond"] })).toBe("respond");
    const built = exampleValueForSchema(INVOICE_SCHEMA);
    expect(validateAgainstSchema(built, INVOICE_SCHEMA)).toEqual([]);
  });
});
