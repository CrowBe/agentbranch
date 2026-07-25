import { createHash } from "node:crypto";

export const CONCEPT_GLOSSARY_TERMS = [
  "Skill",
  "Response schema",
  "Tool contract",
  "Subagent definition",
] as const;

export type ConceptGlossaryTerm = (typeof CONCEPT_GLOSSARY_TERMS)[number];

export type ConceptCitation = {
  readonly source: "CONTEXT.md" | "docs/ARCHITECTURE.md";
  readonly section: string;
};

export type ConceptClaim = {
  readonly text: string;
  readonly citations: readonly [ConceptCitation, ...ConceptCitation[]];
};

type ConceptBase = {
  readonly id: string;
  readonly version: 1;
  readonly title: string;
  readonly terms: readonly [ConceptGlossaryTerm, ...ConceptGlossaryTerm[]];
  readonly idea: ConceptClaim;
  readonly distinction: ConceptClaim;
};

export type DefinitionConcept = ConceptBase & {
  readonly kind: "definition";
  readonly term: ConceptGlossaryTerm;
};

export type DecisionAidOption = {
  readonly term: ConceptGlossaryTerm;
  readonly useWhen: ConceptClaim;
};

export type DecisionAidConcept = ConceptBase & {
  readonly kind: "decision-aid";
  readonly options: readonly [
    DecisionAidOption,
    DecisionAidOption,
    DecisionAidOption,
    DecisionAidOption,
  ];
};

export type Concept = (DefinitionConcept | DecisionAidConcept) & {
  readonly contentHash: string;
};

type ConceptSeed = DefinitionConcept | DecisionAidConcept;

const glossaryCitation = (term: ConceptGlossaryTerm): ConceptCitation => ({
  source: "CONTEXT.md",
  section: `**${term}**:`,
});

const architectureCitation = (section: string): ConceptCitation => ({
  source: "docs/ARCHITECTURE.md",
  section,
});

const seeds = [
  definition({
    id: "skill",
    term: "Skill",
    title: "What a skill is",
    idea:
      "A Skill is a reusable instruction set that tells an AI agent how to handle a particular kind of work.",
    distinction:
      "Choose a Skill when the reusable value is the workflow and judgement, rather than a typed action or output shape.",
  }),
  definition({
    id: "response-schema",
    term: "Response schema",
    title: "What a response schema is",
    idea:
      "A Response schema defines the structured shape an agent or tool must return as a JSON Schema document.",
    distinction:
      "Choose a Response schema when downstream code needs predictable fields and types; it does not describe how to perform an action.",
  }),
  definition({
    id: "tool-contract",
    term: "Tool contract",
    title: "What a tool contract is",
    idea:
      "A Tool contract defines a tool's typed input and output, examples, failure modes, and safety notes.",
    distinction:
      "Choose a Tool contract when an agent must call a bounded action; use a Response schema when only the returned structure needs defining.",
  }),
  definition({
    id: "subagent-definition",
    term: "Subagent definition",
    title: "What a subagent definition is",
    idea:
      "A Subagent definition describes when a specialist should receive delegated work and the role, workflow, and boundaries it follows.",
    distinction:
      "Choose a Subagent definition when work needs a specialist with its own context and instructions; it does not itself run or route that specialist.",
  }),
  {
    id: "equipment-primitive-decision",
    version: 1,
    kind: "decision-aid",
    title: "Which primitive do I need?",
    terms: [...CONCEPT_GLOSSARY_TERMS],
    idea: claim(
      "Pick the primitive that captures the reusable boundary: instructions, output structure, a callable action, or delegated specialist work.",
      architectureCitation("### 9.2 Equipment primitives & composition"),
    ),
    distinction: claim(
      "These primitives compose: a Skill can call a Tool contract whose output follows a Response schema, while a Subagent definition describes a separate specialist.",
      architectureCitation("**Smallest useful composition**"),
      glossaryCitation("Subagent definition"),
    ),
    options: [
      option(
        "Skill",
        "Use for reusable instructions, workflow, and judgement.",
      ),
      option(
        "Response schema",
        "Use when the result must have predictable fields and types.",
      ),
      option(
        "Tool contract",
        "Use when an agent needs a typed, bounded action it can call.",
      ),
      option(
        "Subagent definition",
        "Use when a specialist needs its own context, role, workflow, and boundaries.",
      ),
    ],
  },
] as const satisfies readonly ConceptSeed[];

export const conceptLibrary: readonly Concept[] = seeds.map((seed) => ({
  ...seed,
  contentHash: hashConcept(seed),
}));

function definition(input: {
  readonly id: string;
  readonly term: ConceptGlossaryTerm;
  readonly title: string;
  readonly idea: string;
  readonly distinction: string;
}): DefinitionConcept {
  return {
    id: input.id,
    version: 1,
    kind: "definition",
    title: input.title,
    term: input.term,
    terms: [input.term],
    idea: claim(input.idea, glossaryCitation(input.term)),
    distinction: claim(
      input.distinction,
      glossaryCitation(input.term),
      architectureCitation("### 9.2 Equipment primitives & composition"),
    ),
  };
}

function option(term: ConceptGlossaryTerm, text: string): DecisionAidOption {
  return { term, useWhen: claim(text, glossaryCitation(term)) };
}

function claim(
  text: string,
  ...citations: readonly [ConceptCitation, ...ConceptCitation[]]
): ConceptClaim {
  return { text, citations };
}

function hashConcept(seed: ConceptSeed): string {
  return createHash("sha256").update(JSON.stringify(seed)).digest("hex");
}
