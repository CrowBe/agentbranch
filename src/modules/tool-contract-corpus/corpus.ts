import { createHash } from "node:crypto";
import type { LintSummary } from "@/modules/lint";
import {
  serializeToolContract,
  type ToolContractSource,
} from "@/modules/tool-contract";

export type ToolContractCorpusEntry = {
  readonly id: string;
  readonly version: 1;
  readonly name: string;
  readonly source: ToolContractSource;
  readonly contentHash: string;
  readonly expectedLint: {
    readonly grade: LintSummary["grade"];
    readonly score: number;
    readonly findingCodes: readonly string[];
  };
  readonly provenance: { readonly authoredAt: string; readonly note: string };
};

type Seed = Omit<ToolContractCorpusEntry, "contentHash">;
const AUTHORED_AT = "2026-07-21";
const clean = expected("A", 100, []);

const seeds = [
  contract(
    "read-email",
    "read_email",
    "Read one email by its stable message identifier.",
    object(
      { messageId: stringField("The stable identifier of the email to read.") },
      ["messageId"],
    ),
    ref("EmailTriageDecision"),
    { messageId: "msg_123" },
    {
      action: "reply",
      rationale: "The customer asked a direct question.",
      needsConfirmation: true,
    },
    clean,
    "Matches the test run's built-in email mock and references a curated response schema.",
  ),
  contract(
    "find-calendar-slots",
    "find_calendar_slots",
    "Find available meeting slots inside a requested date range.",
    object(
      {
        attendee: stringField(
          "The attendee whose availability should be checked.",
        ),
        timezone: stringField("The IANA timezone for returned slots."),
      },
      ["attendee", "timezone"],
    ),
    ref("CalendarWeekPlan"),
    { attendee: "alex@example.com", timezone: "Australia/Sydney" },
    {
      timezone: "Australia/Sydney",
      slots: [
        {
          startsAt: "2026-07-22T09:00:00+10:00",
          endsAt: "2026-07-22T09:30:00+10:00",
        },
      ],
    },
    clean,
    "Calendar-category contract with a response-schema reference.",
  ),
  contract(
    "calculate-invoice",
    "calculate_invoice",
    "Calculate invoice line items and a final total from supplied work.",
    object(
      {
        hours: numberField("The billable hours."),
        rate: numberField("The price charged per hour."),
        currency: stringField("The ISO 4217 billing currency."),
      },
      ["hours", "rate", "currency"],
    ),
    ref("InvoiceLineItems"),
    { hours: 2, rate: 150, currency: "AUD" },
    {
      currency: "AUD",
      items: [{ description: "Consulting", quantity: 2, unitPrice: 150 }],
      total: 300,
    },
    clean,
    "Finance-category composition fixture.",
  ),
  contract(
    "extract-policy-obligations",
    "extract_policy_obligations",
    "Extract owners, actions, and deadlines from a supplied policy.",
    object({ document: stringField("The complete policy text to inspect.") }, [
      "document",
    ]),
    ref("PolicyObligations"),
    { document: "Managers must approve leave by Friday." },
    {
      obligations: [
        { owner: "Managers", action: "Approve leave", deadline: "Friday" },
      ],
    },
    clean,
    "Document-category composition fixture.",
  ),
  contract(
    "draft-customer-follow-up",
    "draft_customer_follow_up",
    "Draft a concise customer follow-up from the supplied context.",
    object(
      {
        context: stringField("The previous interaction and desired next step."),
      },
      ["context"],
    ),
    ref("CustomerFollowUp"),
    { context: "Ask whether the customer wants to renew." },
    {
      subject: "Checking in",
      body: "Would you like to discuss renewing your plan?",
    },
    clean,
    "Sales-category fixture whose referenced schema intentionally permits extra fields.",
  ),
  contract(
    "record-receipt",
    "record_receipt",
    "Record bookkeeping fields extracted from a supplied receipt.",
    object(
      {
        receiptText: stringField(
          "The receipt text to extract bookkeeping fields from.",
        ),
      },
      ["receiptText"],
    ),
    ref("ReceiptRecord"),
    { receiptText: "Corner Cafe AUD 12.50" },
    { merchant: "Corner Cafe", total: 12.5, currency: "AUD" },
    clean,
    "Finance fixture referencing the intentionally optional receipt schema.",
  ),
  contract(
    "search-customer-records",
    "search_customer_records",
    "Search customer records using a bounded text query.",
    object(
      { query: stringField("The customer name or identifier to search for.") },
      ["query"],
    ),
    object(
      {
        matches: {
          type: "array",
          description: "The matching customer identifiers.",
          items: { type: "string" },
        },
      },
      ["matches"],
    ),
    { query: "Acme" },
    { matches: ["customer_42"] },
    clean,
    "Generic inline-I/O contract that freezes schema-subset validation.",
  ),
  underspecified(),
] as const satisfies readonly Seed[];

export const toolContractCorpus: readonly ToolContractCorpusEntry[] = seeds.map(
  (entry) => ({
    ...entry,
    contentHash: createHash("sha256")
      .update(serializeToolContract(entry.source))
      .digest("hex"),
  }),
);

function contract(
  id: string,
  name: string,
  description: string,
  input: ToolContractSource["input"],
  output: ToolContractSource["output"],
  exampleInput: unknown,
  exampleOutput: unknown,
  expectedLint: ToolContractCorpusEntry["expectedLint"],
  note: string,
): Seed {
  return {
    id,
    version: 1,
    name,
    source: {
      name,
      description,
      input,
      output,
      examples: [{ input: exampleInput, output: exampleOutput }],
      failureModes: [
        "The requested record is unavailable or the upstream service times out.",
      ],
      safetyNotes: [
        "Return only the minimum data needed for the requested task.",
      ],
      extra: {},
    },
    expectedLint,
    provenance: { authoredAt: AUTHORED_AT, note },
  };
}

function underspecified(): Seed {
  const name = "list_tasks";
  return {
    id: "list-tasks-underspecified",
    version: 1,
    name,
    source: {
      name,
      description: "List tasks for a project.",
      input: object({ projectId: stringField("The project identifier.") }, [
        "projectId",
      ]),
      output: object(
        {
          tasks: {
            type: "array",
            description: "The tasks in the project.",
            items: { type: "string" },
          },
        },
        ["tasks"],
      ),
      examples: [],
      failureModes: [],
      safetyNotes: [],
      extra: {},
    },
    expectedLint: expected("C", 73, [
      "contract.examples.missing",
      "contract.failure-modes.missing",
      "contract.safety-notes.missing",
    ]),
    provenance: {
      authoredAt: AUTHORED_AT,
      note: "Intentionally omits examples, failure modes, and safety notes to freeze lint findings.",
    },
  };
}

function expected(
  grade: LintSummary["grade"],
  score: number,
  findingCodes: readonly string[],
): ToolContractCorpusEntry["expectedLint"] {
  return { grade, score, findingCodes };
}
function ref(name: string): ToolContractSource["output"] {
  return { kind: "schema-ref", ref: name };
}
function object(
  properties: Readonly<Record<string, unknown>>,
  required: readonly string[],
): ToolContractSource["input"] {
  return {
    kind: "inline",
    schema: {
      type: "object",
      description: "A bounded object for this side of the tool call.",
      properties,
      required,
      additionalProperties: false,
    },
  };
}
function stringField(description: string): Readonly<Record<string, unknown>> {
  return { type: "string", description };
}
function numberField(description: string): Readonly<Record<string, unknown>> {
  return { type: "number", description };
}
