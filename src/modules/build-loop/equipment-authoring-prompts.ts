export type EquipmentPrimitiveAuthoringKind = "response-schema" | "tool-contract";

export type EquipmentPrimitiveAuthoringPlan = {
  kind: EquipmentPrimitiveAuthoringKind;
  artifactName: string;
  interviewAnchor: string;
  questions: readonly string[];
  readinessChecklist: readonly string[];
  draftingRules: readonly string[];
  buildingBlockGuidance: string;
};

const SHARED_INTERVIEW_RULES = [
  "Run the interview before the first draft. Ask small numbered rounds in plain language.",
  'Skip the interview only when the request is fully specified or the user says "just draft it".',
  "Press once on vague answers, then restate what you heard so the user can correct it.",
  "Use building blocks that work together; do not restate neighbouring primitives inside this artifact.",
  "Eval feedback patches from evidence and never restarts the interview.",
] as const;

const RESPONSE_SCHEMA_AUTHORING_PLAN: EquipmentPrimitiveAuthoringPlan = {
  kind: "response-schema",
  artifactName: "Response schema",
  interviewAnchor:
    "Anchor the interview on one real filled-in example of the invoice, reply, report, or other output the user wants.",
  questions: [
    "Which fields appear in the example, and what does each field mean?",
    "Which fields are required, optional, or allowed to be empty?",
    "What would make each field wrong: format, allowed values, missing data, or the wrong kind of detail?",
    "What varies between valid examples?",
  ],
  readinessChecklist: [
    "One concrete valid example.",
    "A stated rule for every field.",
    "At least one clear reject condition for invalid output.",
  ],
  draftingRules: [
    "Draft valid JSON Schema.",
    "Embed compact examples when they clarify field boundaries.",
    "Reject only what the user said should be wrong; avoid over-constraining.",
    "Name the schema so tool contracts and evaluation expectations can reference it.",
  ],
  buildingBlockGuidance:
    "A response schema is the shared shape that tool contracts and evaluation expectations point at.",
};

const TOOL_CONTRACT_AUTHORING_PLAN: EquipmentPrimitiveAuthoringPlan = {
  kind: "tool-contract",
  artifactName: "Tool contract",
  interviewAnchor:
    "Anchor the interview on what the tool does in one sentence, then ask what goes in and what comes back by example.",
  questions: [
    "What input does the caller hand to the tool?",
    "What output comes back on the happy path?",
    "What named failure modes should the caller handle: no results, bad input, service down, or something domain-specific?",
    "What should the tool double-check with the user before doing?",
  ],
  readinessChecklist: [
    "One happy-path input/output example.",
    "At least one named failure mode.",
    "The confirmation boundary for sensitive or external actions.",
  ],
  draftingRules: [
    "Draft typed input and output shapes.",
    "Reference response schemas by name instead of inlining duplicate shapes.",
    "Include failure modes and safety notes as first-class contract fields.",
    "Keep examples compact and tied to behaviour the caller must handle.",
  ],
  buildingBlockGuidance:
    "A tool contract is the typed call boundary; it references response schemas by name when their shapes already exist.",
};

const EQUIPMENT_AUTHORING_PLANS = {
  "response-schema": RESPONSE_SCHEMA_AUTHORING_PLAN,
  "tool-contract": TOOL_CONTRACT_AUTHORING_PLAN,
} as const satisfies Record<EquipmentPrimitiveAuthoringKind, EquipmentPrimitiveAuthoringPlan>;

export function getEquipmentPrimitiveAuthoringPlan(
  kind: EquipmentPrimitiveAuthoringKind,
): EquipmentPrimitiveAuthoringPlan {
  return EQUIPMENT_AUTHORING_PLANS[kind];
}

export function renderEquipmentPrimitiveAuthoringPrompt(
  kind: EquipmentPrimitiveAuthoringKind,
): string {
  const plan = getEquipmentPrimitiveAuthoringPlan(kind);

  return [
    `You are authoring a ${plan.artifactName}.`,
    "",
    "Shared interview rules:",
    ...SHARED_INTERVIEW_RULES.map((rule) => `- ${rule}`),
    "",
    "Interview anchor:",
    `- ${plan.interviewAnchor}`,
    "",
    "Questions to resolve:",
    ...plan.questions.map((question) => `- ${question}`),
    "",
    "Readiness checklist:",
    ...plan.readinessChecklist.map((item) => `- ${item}`),
    "",
    "Drafting rules:",
    ...plan.draftingRules.map((rule) => `- ${rule}`),
    "",
    "Building-block guidance:",
    `- ${plan.buildingBlockGuidance}`,
  ].join("\n");
}

