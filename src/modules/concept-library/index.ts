export const CONCEPT_GLOSSARY_TERMS = [
  "Skill",
  "Response schema",
  "Tool contract",
  "Subagent definition",
] as const;

export type ConceptGlossaryTerm = (typeof CONCEPT_GLOSSARY_TERMS)[number];

/** Reviewed definitions copied verbatim from GLOSSARY.md. Concept-context
 * envelopes validate against this map so "reviewed evidence" is a closed,
 * repo-tracked claim rather than caller-supplied prose. */
export const CONCEPT_GLOSSARY: Readonly<Record<ConceptGlossaryTerm, string>> = {
  Skill:
    "The most common primitive in a harness, and the product's entry rung — a reusable, instruction-only instruction set for a Claude agent. No bundled runnable code.",
  "Response schema":
    "The first equipment primitive beyond Skill (§9.2) — a structured output definition, authored as a JSON Schema document. Lossless source model + pure offline lint; its schema subset validates tool-contract examples and test-run calls.",
  "Tool contract":
    "The second equipment primitive — a tool's typed input/output plus description, examples, failure modes, and safety notes. I/O is an inline schema or a `$ref` to a response schema by title. Drives the test run's mock tools and per-call validation when bundled.",
  "Subagent definition":
    "The third equipment primitive — a markdown file with YAML frontmatter (`name`, `description`, optional `tools` and `model`) plus a system-prompt body. Its description controls when a specialist should receive delegated work; its body defines the role, workflow, and boundaries. Analysis only: it does not run or route subagents.",
};

export type ConceptCitation = {
  readonly source: "GLOSSARY.md" | "docs/ARCHITECTURE.md";
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
  source: "GLOSSARY.md",
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

const contentHashes = {
  skill: "95e1c8e5b40636d546d44b9f4793e7bdd2ae11f3bf82eba7b45ebe5afe9249fd",
  "response-schema": "4c64bad10cf7738374877168670c06cac0913099d6dfad7b70be0c837334a15d",
  "tool-contract": "378e141c9de49e73ecf62d2400dbf0b5422bf12089b82ac4c11dd051064fa547",
  "subagent-definition":
    "4f4fc47e0a9f82315045e87f1118986b2db08c99fe2763297713413bb48dcf69",
  "equipment-primitive-decision":
    "53dca5cc652eb1caf968ac4ddd986f506591aa2a04baa0ffaaa0f5e834043d58",
} as const satisfies Readonly<Record<(typeof seeds)[number]["id"], string>>;

export const conceptLibrary: readonly Concept[] = seeds.map((seed) => ({
  ...seed,
  contentHash: contentHashes[seed.id as keyof typeof contentHashes],
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
