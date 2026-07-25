import { createHash } from "node:crypto";
import { canonicalJson } from "@/shared";
import type { JsonOutputPromptCase } from "@/modules/triggering-eval";

export type TaskOutcomeCorpusEntry = {
  readonly id: string;
  readonly version: 1;
  readonly name: string;
  readonly description: string;
  readonly case: JsonOutputPromptCase;
  readonly contentHash: string;
  readonly provenance: {
    readonly authoringTool: string;
    readonly authoredAt: string;
    readonly sourcePrompt: string;
  };
};

type Seed = Omit<TaskOutcomeCorpusEntry, "contentHash">;

const AUTHORING_TOOL = "Agent Branch task-outcome corpus, human curated";
const AUTHORED_AT = "2026-07-26";

const seeds: readonly Seed[] = [
  task({
    id: "overdue-invoice-follow-up",
    name: "Overdue invoice follow-up",
    description: "Turn an accounts-receivable note into a bounded follow-up decision.",
    prompt: "Acme owes AUD 2,450 across two overdue invoices. Return a structured follow-up decision.",
    expectedSchema: object({
      customer: string(),
      currency: string(),
      totalOutstanding: number(),
      overdueInvoices: integer(),
      priority: enumOf(["normal", "high", "urgent"]),
    }, ["customer", "currency", "totalOutstanding", "overdueInvoices", "priority"]),
    sourcePrompt: "Freeze a recognizable SMB accounts-receivable outcome.",
  }),
  task({
    id: "appointment-request-triage",
    name: "Appointment request triage",
    description: "Convert a plain-language booking request into a confirmable next action.",
    prompt: "Jamie wants a 30-minute consultation next Tuesday afternoon. Return the booking decision.",
    expectedSchema: object({
      customerName: string(),
      requestedWindow: string(),
      action: enumOf(["offer-slot", "ask-clarification", "decline"]),
      needsConfirmation: boolean(),
    }, ["customerName", "requestedWindow", "action", "needsConfirmation"]),
    sourcePrompt: "Freeze a non-technical service-business scheduling outcome.",
  }),
  task({
    id: "inventory-reorder-decision",
    name: "Inventory reorder decision",
    description: "Turn stock and sales facts into a constrained reorder recommendation.",
    prompt: "SKU FILTER-20 has 6 units left, sells 4 per week, and takes 3 weeks to restock. Return a reorder decision.",
    expectedSchema: object({
      sku: string(),
      reorderQuantity: integer(0),
      action: enumOf(["reorder", "monitor", "do-not-reorder"]),
      rationale: string(),
    }, ["sku", "reorderQuantity", "action", "rationale"]),
    sourcePrompt: "Freeze a moderately technical inventory-planning outcome.",
  }),
  task({
    id: "weekly-cash-snapshot",
    name: "Weekly cash snapshot",
    description: "Summarize weekly cash movement into bookkeeping-ready numeric fields.",
    prompt: "This week the business received AUD 8,100 and paid AUD 5,725. Return a cash snapshot.",
    expectedSchema: object({
      currency: string(),
      inflows: number(),
      outflows: number(),
      netCashFlow: number(),
    }, ["currency", "inflows", "outflows", "netCashFlow"]),
    sourcePrompt: "Freeze a recognizable SMB bookkeeping outcome.",
  }),
];

export const taskOutcomeCorpus: readonly TaskOutcomeCorpusEntry[] = seeds.map((seed) => ({
  ...seed,
  contentHash: sha256(JSON.stringify(canonicalJson({
    id: seed.id,
    version: seed.version,
    name: seed.name,
    description: seed.description,
    case: seed.case,
    provenance: seed.provenance,
  }))),
}));

export const taskOutcomeCorpusSetHash = sha256(
  taskOutcomeCorpus.map((entry) => `${entry.id}:${entry.contentHash}`).join("\n"),
);

function task(input: {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly prompt: string;
  readonly expectedSchema: Readonly<Record<string, unknown>>;
  readonly sourcePrompt: string;
}): Seed {
  return {
    id: input.id,
    version: 1,
    name: input.name,
    description: input.description,
    case: {
      grader: "json-output",
      graderVersion: 1,
      prompt: input.prompt,
      expectedSchema: input.expectedSchema,
    },
    provenance: {
      authoringTool: AUTHORING_TOOL,
      authoredAt: AUTHORED_AT,
      sourcePrompt: input.sourcePrompt,
    },
  };
}

function object(
  properties: Readonly<Record<string, unknown>>,
  required: readonly string[],
): Readonly<Record<string, unknown>> {
  return { type: "object", properties, required, additionalProperties: false };
}

function string() { return { type: "string" }; }
function number() { return { type: "number" }; }
function integer(minimum?: number) {
  return { type: "integer", ...(minimum === undefined ? {} : { minimum }) };
}
function boolean() { return { type: "boolean" }; }
function enumOf(values: readonly string[]) { return { type: "string", enum: values }; }
function sha256(value: string) { return createHash("sha256").update(value).digest("hex"); }
