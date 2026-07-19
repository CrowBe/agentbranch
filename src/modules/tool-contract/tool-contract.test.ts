import { describe, it, expect } from "vitest";
import { runCapability } from "@/modules/skill-analysis";
import { unwrap, isErr } from "@/shared";
import {
  applyToolContractEdit,
  createToolContractLintReport,
  parseToolContract,
  serializeToolContract,
  toolContractCapability,
} from "./index";

const SEND_INVOICE = {
  name: "send_invoice_reminder",
  description: "Send a payment reminder email for one overdue invoice.",
  input: {
    type: "object",
    additionalProperties: false,
    required: ["invoiceId"],
    properties: {
      invoiceId: { type: "string", description: "The invoice to remind about." },
      tone: { type: "string", enum: ["friendly", "firm"], description: "Reminder tone." },
    },
  },
  output: { $ref: "invoice-summary" },
  examples: [{ input: { invoiceId: "INV-1", tone: "friendly" }, note: "Default reminder." }],
  failureModes: ["invoice not found", "email bounce"],
  safetyNotes: ["Sends outbound email on the user's behalf."],
} as const;

describe("tool-contract source model", () => {
  it("round-trips losslessly, preserving unknown keys and $ref I/O", () => {
    const raw = JSON.stringify({ ...SEND_INVOICE, "x-team": "billing" });
    const source = unwrap(parseToolContract(raw));
    expect(source.output).toEqual({ kind: "schema-ref", ref: "invoice-summary" });
    expect(source.input?.kind).toBe("inline");
    expect(source.extra["x-team"]).toBe("billing");

    const reparsed = unwrap(parseToolContract(serializeToolContract(source)));
    expect(reparsed).toEqual(source);
  });

  it("rejects missing name/description, malformed refs, and malformed lists", () => {
    expect(isErr(parseToolContract("{"))).toBe(true);
    expect(isErr(parseToolContract(JSON.stringify({ description: "d" })))).toBe(true);
    expect(isErr(parseToolContract(JSON.stringify({ name: "t" })))).toBe(true);
    expect(
      isErr(
        parseToolContract(
          JSON.stringify({ name: "t", description: "d", input: { $ref: "s", extra: 1 } }),
        ),
      ),
    ).toBe(true);
    expect(
      isErr(
        parseToolContract(JSON.stringify({ name: "t", description: "d", failureModes: [1] })),
      ),
    ).toBe(true);
  });

  it("applies an exact string edit to the serialized contract", () => {
    const source = unwrap(parseToolContract(JSON.stringify(SEND_INVOICE)));
    const edited = unwrap(
      applyToolContractEdit(source, '"email bounce"', '"email bounce",\n    "invoice already paid"'),
    );
    expect(edited.failureModes).toEqual([
      "invoice not found",
      "email bounce",
      "invoice already paid",
    ]);
  });

  it("fails an edit whose target is empty, absent, or breaks the contract", () => {
    const source = unwrap(parseToolContract(JSON.stringify(SEND_INVOICE)));

    const empty = applyToolContractEdit(source, "", "x");
    expect(isErr(empty) && empty.error.tag === "edit_no_match").toBe(true);

    const missing = applyToolContractEdit(source, "no-such-text", "x");
    expect(isErr(missing) && missing.error.tag === "edit_no_match").toBe(true);

    const broken = applyToolContractEdit(source, '"name": "send_invoice_reminder"', '"name": ""');
    expect(isErr(broken) && broken.error.tag === "invalid_contract").toBe(true);
  });
});

describe("tool-contract lint", () => {
  it("passes a complete contract without errors", () => {
    const report = createToolContractLintReport(
      unwrap(parseToolContract(JSON.stringify(SEND_INVOICE))),
    );
    expect(report.kind).toBe("tool-contract-lint");
    expect(report.summary.counts.error).toBe(0);
  });

  it("flags missing I/O, examples, failure modes, and safety notes", () => {
    const report = createToolContractLintReport(
      unwrap(
        parseToolContract(
          JSON.stringify({ name: "Bad Name!", description: "short", extraKey: true }),
        ),
      ),
    );
    const rules = report.findings.map((f) => f.rule);
    expect(rules).toContain("contract.name.format");
    expect(rules).toContain("contract.description.too-short");
    expect(rules).toContain("contract.input.missing");
    expect(rules).toContain("contract.output.missing");
    expect(rules).toContain("contract.examples.missing");
    expect(rules).toContain("contract.failure-modes.missing");
    expect(rules).toContain("contract.safety-notes.missing");
  });

  it("runs the shared schema shape rules over inline I/O and checks examples against it", () => {
    const report = createToolContractLintReport(
      unwrap(
        parseToolContract(
          JSON.stringify({
            ...SEND_INVOICE,
            input: {
              type: "object",
              required: ["invoiceId"],
              properties: { invoiceId: { type: "string" } },
            },
            examples: [{ input: { tone: 3 } }],
          }),
        ),
      ),
    );
    const rules = report.findings.map((f) => f.rule);
    expect(rules).toContain("schema.property.description-missing");
    expect(rules).toContain("contract.example.input-mismatch");
  });

  it("applies response-schema structural penalties to inline I/O", () => {
    const report = createToolContractLintReport(
      unwrap(
        parseToolContract(
          JSON.stringify({
            ...SEND_INVOICE,
            input: { ...SEND_INVOICE.input, required: [] },
          }),
        ),
      ),
    );

    expect(report.summary).toMatchObject({ grade: "B", score: 85 });
    expect(report.summary.rules).toContain("schema.required.missing");
  });

  it("renders through the seam to insights and breakdown", async () => {
    const source = unwrap(parseToolContract(JSON.stringify(SEND_INVOICE)));
    const insights = unwrap(await runCapability(toolContractCapability, "insights", source));
    expect(insights.summary).toContain("tool contract");
    const breakdown = unwrap(await runCapability(toolContractCapability, "breakdown", source));
    expect(breakdown.findings).toBeDefined();
  });
});
