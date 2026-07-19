import { createHash } from "node:crypto";
import type { LintSummary } from "@/modules/lint";
import {
  serializeResponseSchema,
  type ResponseSchemaSource,
} from "@/modules/response-schema";

export type ResponseSchemaCorpusEntry = {
  readonly id: string;
  readonly version: 1;
  readonly name: string;
  readonly source: ResponseSchemaSource;
  readonly contentHash: string;
  readonly expectedLint: {
    readonly grade: LintSummary["grade"];
    readonly score: number;
    readonly findingCodes: readonly string[];
  };
  readonly provenance: {
    readonly authoredAt: string;
    readonly note: string;
  };
};

type CorpusSeed = Omit<ResponseSchemaCorpusEntry, "contentHash">;

const AUTHORED_AT = "2026-07-19";
const clean = expected("A", 100, []);

const seeds = [
  schema({
    id: "email-triage-decision",
    name: "EmailTriageDecision",
    description: "A bounded routing decision for one unread business email.",
    properties: {
      action: field("string", "The next action to take for this email.", {
        enum: ["reply", "delegate", "schedule", "archive", "urgent-follow-up"],
      }),
      rationale: field("string", "A concise reason for the selected action."),
      needsConfirmation: field("boolean", "Whether the action needs explicit user confirmation."),
    },
    required: ["action", "rationale", "needsConfirmation"],
    expectedLint: clean,
    note: "Clean email-category output with an enumerated decision.",
  }),
  schema({
    id: "invoice-line-items",
    name: "InvoiceLineItems",
    description: "Calculated invoice lines and totals for a client-ready draft.",
    properties: {
      currency: field("string", "The ISO 4217 currency code used by every amount."),
      items: field("array", "The billable lines included on the invoice.", {
        items: object(
          {
            description: field("string", "The work or product represented by this line."),
            quantity: field("number", "The number of units billed on this line."),
            unitPrice: field("number", "The price charged for one unit."),
          },
          ["description", "quantity", "unitPrice"],
        ),
      }),
      total: field("number", "The final amount due across all invoice lines."),
    },
    required: ["currency", "items", "total"],
    expectedLint: clean,
    note: "Clean finance output with a nested array of bounded objects.",
  }),
  schema({
    id: "calendar-week-plan",
    name: "CalendarWeekPlan",
    description: "Proposed meeting slots for one calendar week with timezone context.",
    properties: {
      timezone: field("string", "The IANA timezone applied to every proposed slot."),
      slots: field("array", "The proposed meeting slots in preference order.", {
        items: object(
          {
            startsAt: field("string", "The slot start as an ISO 8601 date-time."),
            endsAt: field("string", "The slot end as an ISO 8601 date-time."),
          },
          ["startsAt", "endsAt"],
        ),
      }),
    },
    required: ["timezone", "slots"],
    expectedLint: clean,
    note: "Clean calendar output that preserves timezone and slot boundaries.",
  }),
  schema({
    id: "policy-obligations",
    name: "PolicyObligations",
    description: "Actionable obligations extracted from a business policy document.",
    properties: {
      obligations: field("array", "The obligations found in the policy.", {
        items: object(
          {
            owner: field("string", "The role responsible for the obligation."),
            action: field("string", "The action the responsible role must complete."),
            deadline: field("string", "The stated deadline, or unknown when absent."),
          },
          ["owner", "action", "deadline"],
        ),
      }),
    },
    required: ["obligations"],
    expectedLint: clean,
    note: "Clean document-analysis output with explicit ownership and deadlines.",
  }),
  schema({
    id: "customer-follow-up-open",
    name: "CustomerFollowUp",
    description: "A follow-up draft and its intended next step for a customer.",
    properties: {
      subject: field("string", "The subject line for the follow-up message."),
      body: field("string", "The complete customer-facing follow-up message."),
    },
    required: ["subject", "body"],
    additionalProperties: true,
    expectedLint: expected("A", 97, ["schema.object.open"]),
    note: "Intentionally permits undeclared fields to freeze the open-object smell.",
  }),
  schema({
    id: "receipt-record-optional",
    name: "ReceiptRecord",
    description: "Bookkeeping fields extracted from one supplied receipt.",
    properties: {
      merchant: field("string", "The merchant shown on the receipt."),
      total: field("number", "The total amount charged on the receipt."),
      currency: field("string", "The ISO 4217 currency code for the total."),
    },
    required: [],
    expectedLint: expected("A", 97, ["schema.required.missing"]),
    note: "Intentionally leaves every field optional so an empty object validates.",
  }),
  schema({
    id: "content-plan-undescribed",
    name: "ContentPlan",
    description: "A channel-ready plan for a short business content campaign.",
    properties: {
      channel: { type: "string" },
      theme: { type: "string" },
      publishDate: { type: "string" },
    },
    required: ["channel", "theme", "publishDate"],
    expectedLint: expected("A", 97, ["schema.property.description-missing"]),
    note: "Intentionally omits property descriptions to freeze guidance quality.",
  }),
  {
    id: "support-answer-unbounded",
    version: 1,
    name: "SupportAnswer",
    source: {
      document: {
        title: "SupportAnswer",
        type: "object",
        properties: {},
        additionalProperties: true,
      },
    },
    expectedLint: expected("B", 76, [
      "schema.description.missing",
      "schema.object.no-properties",
    ]),
    provenance: {
      authoredAt: AUTHORED_AT,
      note: "Intentionally lacks a schema description and any bounded properties.",
    },
  },
] as const satisfies readonly CorpusSeed[];

export const responseSchemaCorpus: readonly ResponseSchemaCorpusEntry[] = seeds.map((entry) => ({
  ...entry,
  contentHash: createHash("sha256").update(serializeResponseSchema(entry.source)).digest("hex"),
}));

function expected(
  grade: LintSummary["grade"],
  score: number,
  findingCodes: readonly string[],
): ResponseSchemaCorpusEntry["expectedLint"] {
  return { grade, score, findingCodes };
}

function schema(input: {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly properties: Readonly<Record<string, unknown>>;
  readonly required: readonly string[];
  readonly additionalProperties?: boolean;
  readonly expectedLint: ResponseSchemaCorpusEntry["expectedLint"];
  readonly note: string;
}): CorpusSeed {
  return {
    id: input.id,
    version: 1,
    name: input.name,
    source: {
      document: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        title: input.name,
        description: input.description,
        type: "object",
        properties: input.properties,
        required: input.required,
        additionalProperties: input.additionalProperties ?? false,
      },
    },
    expectedLint: input.expectedLint,
    provenance: { authoredAt: AUTHORED_AT, note: input.note },
  };
}

function field(
  type: string,
  description: string,
  extras: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> {
  return { type, description, ...extras };
}

function object(
  properties: Readonly<Record<string, unknown>>,
  required: readonly string[],
): Readonly<Record<string, unknown>> {
  return { type: "object", properties, required, additionalProperties: false };
}
