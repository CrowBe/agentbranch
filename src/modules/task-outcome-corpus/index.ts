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
    prompt: "Acme owes exactly AUD 2,450 across exactly two overdue invoices. Under this frozen policy, two or more overdue invoices totaling at least AUD 2,000 have high priority. Return exactly: customer Acme, currency AUD, totalOutstanding 2450, overdueInvoices 2, priority high.",
    expectedSchema: object({
      customer: constant("Acme"),
      currency: constant("AUD"),
      totalOutstanding: constant(2450),
      overdueInvoices: constant(2),
      priority: constant("high"),
    }, ["customer", "currency", "totalOutstanding", "overdueInvoices", "priority"]),
    sourcePrompt: "Freeze a recognizable SMB accounts-receivable outcome.",
  }),
  task({
    id: "appointment-request-triage",
    name: "Appointment request triage",
    description: "Convert a plain-language booking request into a confirmable next action.",
    prompt: "Jamie requests a 30-minute consultation in the window Tuesday afternoon. The frozen scheduling policy says an available window is offered and requires customer confirmation. Return exactly: customerName Jamie, requestedWindow Tuesday afternoon, action offer-slot, needsConfirmation true.",
    expectedSchema: object({
      customerName: constant("Jamie"),
      requestedWindow: constant("Tuesday afternoon"),
      action: constant("offer-slot"),
      needsConfirmation: constant(true),
    }, ["customerName", "requestedWindow", "action", "needsConfirmation"]),
    sourcePrompt: "Freeze a non-technical service-business scheduling outcome.",
  }),
  task({
    id: "inventory-reorder-decision",
    name: "Inventory reorder decision",
    description: "Turn stock and sales facts into a constrained reorder recommendation.",
    prompt: "SKU FILTER-20 has exactly 6 units left, demand is exactly 4 units per week, and restock lead time is exactly 3 weeks. The frozen policy orders lead-time demand (12 units) when current stock is below it. Return exactly: sku FILTER-20, reorderQuantity 12, action reorder, rationale Stock cover is shorter than lead time.",
    expectedSchema: object({
      sku: constant("FILTER-20"),
      reorderQuantity: constant(12),
      action: constant("reorder"),
      rationale: constant("Stock cover is shorter than lead time."),
    }, ["sku", "reorderQuantity", "action", "rationale"]),
    sourcePrompt: "Freeze a moderately technical inventory-planning outcome.",
  }),
  task({
    id: "weekly-cash-snapshot",
    name: "Weekly cash snapshot",
    description: "Summarize weekly cash movement into bookkeeping-ready numeric fields.",
    prompt: "This week the business received exactly AUD 8,100 and paid exactly AUD 5,725. Net cash flow is inflows minus outflows. Return exactly: currency AUD, inflows 8100, outflows 5725, netCashFlow 2375.",
    expectedSchema: object({
      currency: constant("AUD"),
      inflows: constant(8100),
      outflows: constant(5725),
      netCashFlow: constant(2375),
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

function constant(value: string | number | boolean) {
  return { type: typeof value === "number" ? "number" : typeof value, const: value };
}
function sha256(value: string) { return createHash("sha256").update(value).digest("hex"); }
