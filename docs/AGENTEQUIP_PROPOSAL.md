# AgentEquip — proposal and roadmap

> Proposal document. This is not the product source of truth until the
> architecture glossary is updated and a second equipment primitive ships.

## Thesis

SkillSmith is currently a strong skill-building and validation tool. AgentEquip
is the broader product shape: a platform for building, inspecting, evaluating,
and revising the declarative primitives that equip an AI agent.

The rename earns its meaning only when the product handles more than Skills. A
brand change before that would be cosmetic. The first real AgentEquip moment is
composition: evaluate a Skill against another primitive, such as a Tool contract
or Response schema.

## Core language

**Equipment**:
Any declarative primitive that changes what an agent can do, know, decide, or
safely access.

**Equipment primitive**:
A first-class equipment type with a source model, analyzer/linter, renderer, and
optionally an evaluator.

**Composition**:
The relationship layer between primitives. Individual linting is useful, but the
platform becomes distinctive when it can answer cross-primitive questions:

- Does this Skill call the Tool correctly?
- Does the Tool output match the Response schema?
- Does the Skill stay inside the declared Policy?
- Did this revision improve or degrade against previous evals?

## Current state

The product currently does one primitive well: **Skills**.

The Skill loop is mostly in place:

- build in chat
- inspect through Rendered/Source, Visualise, and Lint
- evaluate through Test run and Triggering eval
- revise from evaluation feedback
- persist skill versions and evaluation records

The skill-analysis seam has been generalized in code:

- `Analyzer<Input, A>`
- `Evaluator<Input, A>`
- `runCapability(capability, surface, input, context?)`

That means the seam can accept future primitive input types without a new
pipeline. However, every concrete subject today is still `Skill`. The product is
seam-ready for equipment, but not yet an equipment product.

## Gaps before AgentEquip is real

### 1. Relational evaluation

Primitives currently have little awareness of each other. A Skill evaluated in
isolation can give false confidence. Real agent reliability questions are
relational:

- a Skill using a Tool
- a Tool returning a Response schema
- a Policy constraining allowed behaviour
- an Eval pack testing a composition

This should be additive on the seam. Evaluators get richer input context; they
do not become a new pipeline.

### 2. Regression comparison

Evaluation records are versioned, but the UI does not yet answer the product
question users will care about: did this revision make the agent better or
worse?

Regression comparison turns evals from one-shot events into an improvement
record. That is a retention hook and a serious validation story.

### 3. User-authored test materials

Current evaluator conditions are mostly platform-generated. Users need a way to
bring real failure cases:

- prompts that should trigger
- prompts that should stay silent
- concrete scenarios
- edge cases from actual work
- adversarial inputs

This should extend existing evaluators before becoming a separate top-level
primitive.

## Equipment primitive roadmap

### Tier 1: Ship these to earn the name

#### 1. Response schemas

Structured output definitions, such as JSON Schema or typed response shapes.

Why first:

- low implementation cost
- pure linting is immediately valuable
- easy to validate deterministically
- useful for Tool inputs, Tool outputs, eval expectations, and fixtures

Response schemas are the cleanest first non-Skill primitive because they do not
require runtime orchestration.

#### 2. Tool contracts

Typed input/output schemas plus descriptions, examples, failure modes, and
safety notes for tools an agent can call.

Why next:

- Tools are how agents act in the world.
- "Does this Skill call this Tool correctly?" is the first practical
  cross-primitive evaluation question.
- Tool contracts compose naturally with Response schemas.

The first relational evaluator should be small: extend Test run so a Skill can
call a mocked Tool contract and validate the call arguments/output shape.

#### 3. Policies / guardrails

Declarative constraints describing what an agent may and may not do.

Examples:

- allowed/disallowed tool actions
- human-confirmation requirements
- data handling constraints
- network/file access rules
- output constraints

Why after Tools and Schemas:

- Policies become concrete when there are actions and outputs to constrain.
- Lint can catch obvious violations.
- Evaluation can test whether the constraint actually holds under pressure.

Policies may later support publication/moderation gates, but their first product
value should be local agent safety and reliability.

### Tier 2: Ship once evaluation composition is stronger

#### 4. Agent profiles

Durable identity and defaults: system prompt, role, tone, operating style, model
preference, and default equipment list.

Why later:

- The analysis half is easy.
- The evaluation half needs rubric or LLM-judge support to answer whether the
  profile behaves correctly across tasks.

#### 5. Knowledge packs

Bounded reference knowledge an agent can consult. Lightweight RAG-adjacent, but
without vector database infrastructure.

Why later:

- "Is this knowledge useful?" is task-dependent.
- Knowledge packs become meaningful when evaluated as part of a profile + skill
  + tool bundle, not as standalone documents.

## Execution order

1. **Keep the eval-feedback loop sharp**
   Evaluation feedback and lint feedback now close the build loop. Keep new
   primitives on the same pattern: structured finding → formatted feedback →
   targeted revision.

2. **Document the AgentEquip direction**
   Update architecture language to define Equipment, Equipment primitive, and
   Composition. Do not perform a full product/repo rename until a second
   primitive ships.

3. **Add user-authored test materials**
   Let users seed Triggering eval and Test run with their own prompts and
   scenarios. This improves the current Skill product immediately and prepares
   the ground for Eval packs.

4. **Ship Response schemas**
   First non-Skill primitive. Build, lint, render, and validate schema examples.

5. **Ship Tool contracts**
   Use Response schemas for tool inputs/outputs. Add the first relational test:
   Skill + Tool contract inside Test run.

6. **Add regression comparison**
   Compare evaluation records across revisions so users can see improvement or
   regression.

7. **Ship Policies / guardrails**
   Add declarative constraints and evaluate Skill + Tool + Policy bundles.

8. **Add Agent profiles and Knowledge packs**
   Promote them once composition and evaluation can say something meaningful
   about behaviour.

## Non-goals for the first expansion

- Full RAG pipelines
- Vector database infrastructure
- Runtime orchestration for containers
- Subagent routing
- Marketplace or publication moderation as the first policy use case
- A repo/product rename before a second primitive proves the AgentEquip thesis

## Product test

AgentEquip is real when the product can answer this:

> Here is a Skill, a Tool contract, and a Response schema. Does the Skill call
> the Tool correctly and produce valid output?

That is the smallest useful composition. It is broader than SkillSmith without
dragging in heavyweight runtime infrastructure.
