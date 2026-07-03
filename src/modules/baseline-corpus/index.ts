import { createHash } from "node:crypto";

export type BaselinePromptCase = {
  readonly prompt: string;
  readonly expected: "fire" | "silent";
};

export type BaselineSkillProvenance = {
  readonly authoringTool: string;
  readonly authoredAt: string;
  readonly sourcePrompt: string;
};

export type BaselineSkillCorpusEntry = {
  readonly id: string;
  readonly version: 1;
  readonly name: string;
  readonly description: string;
  readonly source: string;
  readonly contentHash: string;
  readonly promptBattery: readonly BaselinePromptCase[];
  readonly provenance: BaselineSkillProvenance;
};

type CorpusSeed = Omit<BaselineSkillCorpusEntry, "contentHash">;

const AUTHORING_TOOL = "Anthropic skill-creator pattern, curated fixture";
const AUTHORED_AT = "2026-07-03";

const seeds = [
  skill({
    id: "inbox-triage",
    name: "inbox-triage",
    description: "Triage unread business email into reply, delegate, schedule, archive, or urgent follow-up.",
    sourcePrompt: "Create an inbox triage skill for an SMB owner handling unread email.",
    body: [
      "## When to use",
      "Use this skill when the user asks to sort, prioritise, or decide next actions for unread business email.",
      "",
      "Do not use it for writing a full outbound campaign, managing calendar conflicts, or extracting data from attachments.",
      "",
      "## Workflow",
      "1. Read the sender, subject, received time, thread context, and any supplied labels.",
      "2. Classify each message as reply, delegate, schedule, archive, or urgent follow-up.",
      "3. Call out missing context before recommending a destructive action.",
      "4. Present a compact queue with the reason for each label and the next action.",
      "",
      "## Guardrails",
      "- Never send, delete, or forward email without explicit confirmation.",
      "- Keep private customer details out of summaries unless the user asked for them.",
    ],
    positives: [
      "Sort my unread customer emails and tell me which need a reply today.",
      "Triage this inbox export into urgent follow-ups and archive candidates.",
      "Which of these new emails should I delegate to operations?",
    ],
    negatives: [
      "Draft a newsletter for every customer on my list.",
      "Find a time for the client call next week.",
      "Extract invoice totals from these PDFs.",
    ],
  }),
  skill({
    id: "meeting-scheduler",
    name: "meeting-scheduler",
    description: "Find suitable meeting times, prepare scheduling options, and draft concise calendar invitations.",
    sourcePrompt: "Create a meeting scheduling skill for a busy small-business operator.",
    body: [
      "## When to use",
      "Use this skill when the user needs help arranging, moving, or confirming a meeting.",
      "",
      "Do not use it for taking meeting notes, summarising transcripts, or planning an event agenda from scratch.",
      "",
      "## Workflow",
      "1. Identify attendees, duration, timezone, deadline, and any immovable constraints.",
      "2. Compare the supplied availability and propose the smallest useful set of options.",
      "3. Draft the invite title, agenda bullets, location or link, and confirmation message.",
      "4. Ask before committing calendar changes or sending invitations.",
      "",
      "## Guardrails",
      "- Preserve timezone names in user-facing options.",
      "- Flag conflicts instead of silently overriding them.",
    ],
    positives: [
      "Find three times for a 30 minute client meeting next week.",
      "Move tomorrow's supplier call and draft the calendar update.",
      "Schedule a kickoff with Alex and Priya before Friday.",
    ],
    negatives: [
      "Summarise the notes from yesterday's client call.",
      "Triage my unread email by urgency.",
      "Write a data extraction schema for receipts.",
    ],
  }),
  skill({
    id: "receipt-expense-logger",
    name: "receipt-expense-logger",
    description: "Turn receipt details into expense records with category, tax, reimbursement, and review flags.",
    sourcePrompt: "Create a receipt expense logging skill for SMB bookkeeping.",
    body: [
      "## When to use",
      "Use this skill when the user provides receipts, transaction notes, or reimbursement details to record expenses.",
      "",
      "Do not use it for producing invoices, reconciling a full bank feed, or giving tax advice.",
      "",
      "## Workflow",
      "1. Extract merchant, date, currency, total, tax, payment method, and business purpose.",
      "2. Assign a likely category and confidence level.",
      "3. Mark missing values and duplicates for review.",
      "4. Return ledger-ready rows plus questions needed before submission.",
      "",
      "## Guardrails",
      "- Do not invent tax treatment or compliance claims.",
      "- Keep personal purchases separate from business expenses.",
    ],
    positives: [
      "Log these lunch receipts and flag which ones need a business purpose.",
      "Categorise this pile of travel expenses for reimbursement.",
      "Turn this receipt text into expense rows with GST separated.",
    ],
    negatives: [
      "Create an invoice for my consulting hours.",
      "Summarise a policy document into bullets.",
      "Schedule a finance review meeting.",
    ],
  }),
  skill({
    id: "invoice-drafter",
    name: "invoice-drafter",
    description: "Draft invoice line items from billable work, rates, dates, terms, and client details.",
    sourcePrompt: "Create an invoice drafting skill for service businesses.",
    body: [
      "## When to use",
      "Use this skill when the user needs an invoice draft from supplied work, rates, client details, or timesheets.",
      "",
      "Do not use it for collecting payment, changing accounting records, or logging reimbursable receipts.",
      "",
      "## Workflow",
      "1. Confirm client name, invoice period, currency, payment terms, and tax requirements.",
      "2. Convert work notes into clear line items with quantities, rates, and totals.",
      "3. Highlight assumptions and missing details before finalising.",
      "4. Provide a client-ready invoice draft and a short covering note.",
      "",
      "## Guardrails",
      "- Never claim an invoice has been sent or paid.",
      "- Keep calculations visible so the user can check them.",
    ],
    positives: [
      "Draft an invoice for 12 hours of consulting at 180 dollars per hour.",
      "Turn these billable work notes into invoice line items.",
      "Prepare a client invoice with net 14 payment terms.",
    ],
    negatives: [
      "Categorise these cafe receipts for bookkeeping.",
      "Write a social media post for our launch.",
      "Review this contract for risky clauses.",
    ],
  }),
  skill({
    id: "policy-summariser",
    name: "policy-summariser",
    description: "Summarize policy or procedure documents into obligations, deadlines, owners, and open questions.",
    sourcePrompt: "Create a document summarisation skill for business policies and procedures.",
    body: [
      "## When to use",
      "Use this skill when the user asks for a plain-language summary of a policy, procedure, or operating document.",
      "",
      "Do not use it for legal advice, contract negotiation, or drafting new policy from scratch.",
      "",
      "## Workflow",
      "1. Identify the document purpose, audience, effective date, and scope.",
      "2. Summarise obligations, deadlines, exceptions, and responsible roles.",
      "3. Separate facts from interpretation and list unclear clauses.",
      "4. End with actions the user can take next.",
      "",
      "## Guardrails",
      "- Preserve exact wording for must, must not, and deadline language when it matters.",
      "- Say when a legal or compliance professional should review.",
    ],
    positives: [
      "Summarise this leave policy into manager obligations.",
      "What are the deadlines and responsibilities in this procedure?",
      "Condense this vendor policy into actions for our team.",
    ],
    negatives: [
      "Draft an invoice for this month's work.",
      "Sort my inbox by which emails need replies.",
      "Generate captions for a product launch.",
    ],
  }),
  skill({
    id: "customer-follow-up",
    name: "customer-follow-up",
    description: "Draft customer follow-up messages from context, desired outcome, tone, and timing.",
    sourcePrompt: "Create a customer follow-up drafting skill for sales and support.",
    body: [
      "## When to use",
      "Use this skill when the user needs a one-to-one follow-up message for a customer, lead, or support contact.",
      "",
      "Do not use it for bulk marketing campaigns, internal meeting scheduling, or CRM data cleanup.",
      "",
      "## Workflow",
      "1. Identify the relationship, previous interaction, objective, and any promised next step.",
      "2. Choose the shortest tone that fits the situation.",
      "3. Draft the message with a clear ask or next action.",
      "4. Offer a firmer or warmer variant when useful.",
      "",
      "## Guardrails",
      "- Do not promise discounts, timelines, or outcomes the user did not provide.",
      "- Keep sensitive account details out of the draft unless needed.",
    ],
    positives: [
      "Write a polite follow-up to a customer who missed our demo.",
      "Draft a support check-in after yesterday's repair visit.",
      "Follow up with this lead and ask whether they want a quote.",
    ],
    negatives: [
      "Create a weekly content calendar for LinkedIn.",
      "Classify these receipts by expense category.",
      "Summarise a procedure document for managers.",
    ],
  }),
  skill({
    id: "data-extraction-brief",
    name: "data-extraction-brief",
    description: "Define fields, examples, validation rules, and edge cases for extracting data from messy documents.",
    sourcePrompt: "Create a data extraction brief skill for forms, PDFs, and emails.",
    body: [
      "## When to use",
      "Use this skill when the user wants a structured extraction plan or schema for messy source documents.",
      "",
      "Do not use it for running the extraction, scraping websites, or interpreting legal meaning.",
      "",
      "## Workflow",
      "1. Identify the document type, business goal, and destination format.",
      "2. Define fields with types, examples, required status, and validation rules.",
      "3. List ambiguous cases and how to handle missing or conflicting values.",
      "4. Return a compact extraction brief the user can hand to an agent or analyst.",
      "",
      "## Guardrails",
      "- Do not invent source values.",
      "- Mark personally sensitive fields so the user can apply access controls.",
    ],
    positives: [
      "Design a schema to extract order numbers and totals from supplier PDFs.",
      "What fields should we pull from these application emails?",
      "Make an extraction brief for these onboarding forms.",
    ],
    negatives: [
      "Summarise this policy in plain language.",
      "Draft a customer apology email.",
      "Book a meeting with the supplier.",
    ],
  }),
  skill({
    id: "job-posting-drafter",
    name: "job-posting-drafter",
    description: "Draft practical job postings from role outcomes, must-haves, schedule, location, and hiring constraints.",
    sourcePrompt: "Create a hiring job-post drafting skill for a small team.",
    body: [
      "## When to use",
      "Use this skill when the user needs a clear job posting or role advert from supplied hiring details.",
      "",
      "Do not use it for screening candidates, writing performance reviews, or negotiating offers.",
      "",
      "## Workflow",
      "1. Clarify role outcomes, required skills, nice-to-haves, location, schedule, and pay range if provided.",
      "2. Draft a plain-language posting with responsibilities, requirements, and application steps.",
      "3. Remove exclusionary or inflated wording unless the user explicitly needs it.",
      "4. Provide a short social-share version.",
      "",
      "## Guardrails",
      "- Do not invent salary, visa, or legal requirements.",
      "- Flag wording that could be discriminatory or misleading.",
    ],
    positives: [
      "Draft a job ad for a part-time operations assistant.",
      "Turn these role notes into a hiring post.",
      "Write a practical job posting for a cafe manager.",
    ],
    negatives: [
      "Screen these candidate resumes and rank them.",
      "Write a customer follow-up email.",
      "Log these business expenses.",
    ],
  }),
  skill({
    id: "brand-social-drafter",
    name: "brand-social-drafter",
    description: "Draft short social posts from campaign context, audience, channel, offer, and brand voice notes.",
    sourcePrompt: "Create a social post drafting skill for small-business marketing.",
    body: [
      "## When to use",
      "Use this skill when the user asks for short social media copy for a known brand, campaign, or announcement.",
      "",
      "Do not use it for one-to-one customer follow-up, long-form blog posts, or paid ad strategy.",
      "",
      "## Workflow",
      "1. Identify channel, audience, offer, deadline, call to action, and voice constraints.",
      "2. Draft two or three concise options with different angles.",
      "3. Include hashtag or formatting suggestions only when relevant to the channel.",
      "4. Note any missing claim, price, or availability detail before publication.",
      "",
      "## Guardrails",
      "- Do not make factual claims the user did not supply.",
      "- Avoid manipulative urgency unless the user provided a real deadline.",
    ],
    positives: [
      "Write three Instagram captions for our winter menu launch.",
      "Draft a LinkedIn post announcing the new service package.",
      "Make a short social post for this weekend's sale.",
    ],
    negatives: [
      "Follow up with a customer after a support ticket.",
      "Summarise a policy document.",
      "Create fields for extracting invoice data.",
    ],
  }),
  skill({
    id: "contract-risk-spotter",
    name: "contract-risk-spotter",
    description: "Spot practical business risks in a contract excerpt and prepare questions for professional review.",
    sourcePrompt: "Create a contract risk spotting skill for non-lawyer business users.",
    body: [
      "## When to use",
      "Use this skill when the user wants practical risks, obligations, or questions from a contract excerpt.",
      "",
      "Do not use it for legal advice, negotiation strategy, or final approval of a contract.",
      "",
      "## Workflow",
      "1. Identify parties, dates, payment terms, renewal, termination, liability, confidentiality, and deliverables.",
      "2. List practical risks in plain language with the clause or phrase that raised each issue.",
      "3. Separate business questions from legal-review questions.",
      "4. Suggest information the user should gather before asking a professional.",
      "",
      "## Guardrails",
      "- Say clearly that the output is not legal advice.",
      "- Preserve exact clause wording when quoting risk triggers.",
    ],
    positives: [
      "Review this contract excerpt for practical business risks.",
      "What questions should I ask a lawyer about this supplier agreement?",
      "Spot obligations and renewal risks in these terms.",
    ],
    negatives: [
      "Summarise our internal leave policy for managers.",
      "Draft a social caption for a sale.",
      "Schedule a meeting with the supplier.",
    ],
  }),
] as const satisfies readonly CorpusSeed[];

export const baselineSkillCorpus: readonly BaselineSkillCorpusEntry[] = seeds.map((entry) => ({
  ...entry,
  contentHash: sha256(entry.source),
}));

export const baselineDistractors = baselineSkillCorpus.map(({ name, description }) => ({
  name,
  description,
}));

function skill(input: {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly sourcePrompt: string;
  readonly body: readonly string[];
  readonly positives: readonly string[];
  readonly negatives: readonly string[];
}): CorpusSeed {
  return {
    id: input.id,
    version: 1,
    name: input.name,
    description: input.description,
    source: `---\nname: ${input.name}\ndescription: ${input.description}\n---\n\n${input.body.join("\n")}\n`,
    promptBattery: [
      ...input.positives.map((prompt) => ({ prompt, expected: "fire" as const })),
      ...input.negatives.map((prompt) => ({ prompt, expected: "silent" as const })),
    ],
    provenance: {
      authoringTool: AUTHORING_TOOL,
      authoredAt: AUTHORED_AT,
      sourcePrompt: input.sourcePrompt,
    },
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
