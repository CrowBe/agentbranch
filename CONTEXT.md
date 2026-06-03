# SkillBuilder — Domain Language

The ubiquitous-language contract for SkillBuilder. One term per concept, opinionated, with the aliases to avoid. This is the *language* layer; `docs/ARCHITECTURE.md` §2 is the product-decision glossary and stays the source of truth for *why* each decision was made. When they overlap, this file sharpens the word and ARCHITECTURE carries the rationale.

## Language

**Skill**:
The product's unit of work — a reusable, instruction-only instruction set for a Claude agent. No bundled runnable code.
_Avoid_: prompt, agent, bot, automation

**`SKILL.md`**:
A skill's source file — YAML frontmatter (`name`, `description`) + markdown body. The lossless source of truth a skill round-trips through.
_Avoid_: spec, config, manifest

**Skill record**:
A persisted skill in our DB — `SKILL.md` source plus identity and timestamps. Everything else is derived from it.
_Avoid_: skill row, skill entity, document

**Build loop**:
The core agentic loop — Claude (via Vercel AI SDK) writes/edits the `SKILL.md` through `write_skill`/`edit_skill`, streaming to the preview.
_Avoid_: chat, conversation, agent loop, generation

**Skill-analysis seam**:
The architectural spine — the shared pattern *read skill → emit a structured artifact → render it for a surface*. Built once; every capability is a renderer on it, not a new pipeline.
_Avoid_: pipeline, service, the analyzer

**Analysis capability**:
A *static* capability on the seam — reads the skill's text and derives a structured view. Pure, deterministic, no model call (or a single bounded one), no agent loop. The Rendered hero, Source view, Visualise, and Export are analysis capabilities.
_Avoid_: render, view (those name the output, not the capability)

**Evaluation capability**:
A *dynamic* capability on the seam — runs the skill through a model and observes its behaviour. Non-deterministic, costs tokens. Test run and Triggering eval are evaluation capabilities. An Evaluator **owns its method, not its resources**: it builds its own conditions (Scenario / distractor field / Prompt battery) and runs the skill, but the model + meter are handed in via the **Evaluation harness**. Its signature is `evaluate(skill, harness)` — no external input parameter; the evaluator constructs its own world, borrowing the harness when generation needs a model.
_Avoid_: execution, validation (overloaded), check

**Artifact**:
The structured thing an analyzer emits before rendering, discriminated by a closed `kind`. One kind per capability.
_Avoid_: output, result, payload, IR (the IR is one artifact kind, not the category)

**Skill IR**:
*One* artifact kind, produced by Visualise — nodes + edges, each carrying a source-span back into `SKILL.md`. A Visualise concept, not the seam itself.
_Avoid_: graph, AST, model (it is not the whole seam)

**Evaluation result**:
The Artifact an Evaluation capability emits — the structured run-record (which prompts fired, pass/fail, the mock-tool transcript). Ephemeral, lives on the seam, *never shown raw*. Internal term; never user copy.
_Avoid_: report (smells like a data wall), results table, output, log

**Insights**:
*User-facing term* for the default rendered surface of an Evaluation result — a meaningful, plain-language presentation the user can act on ("fires on the right prompts, watch this one"). The interpreted view, not the raw run-record. A second renderer (a detailed breakdown) sits behind it for technical depth — the same Rendered/Source duality as the hero.
_Avoid_: report, results, test output, eval data

**Evaluation harness**:
The thin port handed to an Evaluator (`evaluate(skill, harness)`) — wraps the model provider *and* the usage meter, exposing intent-level operations (e.g. "would the skill be selected for this prompt?", "run the skill against this scenario") rather than the raw `LanguageModel`. Keeps AI-SDK plumbing and token metering in one infra adapter, out of every evaluator. An evaluator's job is **evaluation → insight**; it owns neither the model nor the meter — they live behind the harness, handed in.
_Avoid_: model, the SDK, runner, engine (engine is the portability transform)

**Evaluation record**:
The *persisted* row for an evaluation (`test_runs` / `eval_runs`, ARCHITECTURE §6) — append-only, has identity and lifetime. Distinct from the ephemeral Evaluation result: the result is what we render *now*; the record is what we store and can re-render later. Analysis artifacts (Mermaid, Rendered doc) are *not* persisted — they recompute on demand. This asymmetry (evaluations persist, analyses recompute) is real and load-bearing.
_Avoid_: run row, history entry (in user copy: "past run")

**Source-span**:
A character range `{ start, end }` back into `SKILL.md`. An artifact node carries one so a surface can offer "click here → jump to the line that produced it."
_Avoid_: location, range, position, pointer

**Test run**:
*User-facing term* for executing a skill against mocked tools to see how it behaves. Nothing real is ever touched.
_Avoid_: **sandbox** (banned — intimidates both audiences), execution, simulation, dry run

**Mock-tool registry**:
The mechanism behind a test run — when the skill calls a tool, the registry returns generated mock data instead of doing anything real. Internal term; never surfaced in user copy.
_Avoid_: stub, fake (in user copy); harness, interceptor (jargon)

**Triggering eval**:
The v1 validation — does the skill *fire* on the right prompts and *stay silent* on the wrong ones? Run against a distractor library + a positive/negative prompt battery.
_Avoid_: trigger test, firing test, selection eval

**Scenario**:
The situation a test run is run against — `{ prompt, seedData }`, one per run in v1 (ARCHITECTURE §4). Built by the test-run evaluator itself (generated to stress the skill, so generation borrows the harness), not handed in.
_Avoid_: case, situation, fixture, environment

**Distractor library**:
The set of competing skills a triggering eval runs the candidate against, so selection is tested competitively rather than in isolation. Assembled by the triggering-eval evaluator as part of its method.
_Avoid_: decoys, noise, negatives

**Prompt battery**:
The positive + negative prompts a triggering eval fires at the skill — positives should trigger it, negatives should not.
_Avoid_: test set, prompts, dataset

**Portability transform**:
The one engine that strips Claude-specific scaffolding and re-expresses a skill's intent for another target. Two surfaces, one engine: cross-provider validation and cross-primitive export.
_Avoid_: converter, adapter, exporter (export is one surface, not the engine)

**Rendered view** / **Source view**:
The hero's two views of the same skill. **Rendered** (default) = friendly sans-serif document. **Source** = raw monospace `SKILL.md`. Both are renderers on the seam.
_Avoid_: preview/raw, doc/code, formatted/plain

## Relationships

- A **Skill record** persists exactly one `SKILL.md` **source**.
- The **Skill-analysis seam** carries every **Analysis capability** and **Evaluation capability** — both render a named surface from an Artifact, differing in how the Artifact is produced.
- An **Analysis capability** wraps an **Analyzer** (`analyze(skill)`) — Artifact from the skill's text alone.
- An **Evaluation capability** wraps an **Evaluator** (`evaluate(skill, harness)`) — it builds its own conditions and runs the skill, emitting an Artifact. It owns its **method** (how it builds + runs its world); it does **not** own its **resources** (model + meter — handed in via the **Evaluation harness**).
- When no model is configured (offline / no key) an Evaluation capability cannot run — it fails with the shared `model_unavailable` **DomainError**, checked once in the seam's evaluation path, not in each evaluator. Analysis capabilities still run offline (pure text). This is evaluation's hard dependency that analysis doesn't have.
- **Visualise** is an Analysis capability whose Artifact is the **Skill IR**; each IR node carries a **Source-span**.
- A **Test run** drives the **Mock-tool registry**; a **Triggering eval** drives the **Distractor library** + **Prompt battery**. Both are Evaluation capabilities.
- An **Evaluation capability** emits an **Evaluation result** (the run-record Artifact), which renders to **Insights** (default, plain-language) and a detailed breakdown (depth on demand) — two renderers, one result.
- An **Evaluation result** is ephemeral on the seam; it is persisted as an **Evaluation record** (§6). Analysis artifacts are never persisted — they recompute. The result is rendered *now*; the record is re-rendered *later*.
- The **Portability transform** is one engine feeding two surfaces (cross-provider validation, cross-primitive export) — both deferred in v1.

## Example dialogue

> **Dev:** "Export reads the skill and emits a `.zip` — that's the same shape as Visualise, right? Both analysis capabilities?"
> **Domain expert:** "Yes. Both read the text and render a view, no model loop. A **Test run** is the other shape — it *runs* the skill against the **mock-tool registry** and watches what happens. Same seam, but it's an **evaluation capability**, not an analysis one."
> **Dev:** "Does the test-run evaluator get handed the scenario to run?"
> **Domain expert:** "No — it builds its own **Scenario**. Building the world it runs in is its *method*, and that's what makes it the test-run evaluator. What it's handed is the **harness** — the model and the meter — because those are shared, sensitive **resources** it doesn't own. Method in, resources handed in."
> **Dev:** "But generating a scenario to stress the skill needs a model call."
> **Domain expert:** "Right — so it borrows the harness for that step. Borrowing a resource isn't owning it. The Anthropic key and the meter still live in one place."
> **Dev:** "Then it spits out the run data?"
> **Domain expert:** "It emits an **Evaluation result** — the raw run-record. That's never shown raw. It renders to **Insights**: plain language the user can act on. Same seam, evaluation side."
> **Dev:** "So when I add trigger-overlap detection later?"
> **Domain expert:** "Ask which shape first. It runs the skill against the user's other skills — that's evaluation. New `ArtifactKind`, evaluation shape, owns its method, handed the harness, renders to Insights. Not a new pipeline."

## Flagged ambiguities

- **"seam" used flat** — the code's `ArtifactKind` union mixes static views (`hero`, `skill-ir`, `export`) with dynamic executions (`test-run`, `triggering-eval`). Resolved: one seam, two capability shapes — **Analysis** (static) and **Evaluation** (dynamic). Naming the shapes tells a future author which one a new capability is before they pick analyzer + renderer.
- **"the run results" used to mean two things** — the raw run-record vs. what the user sees. Resolved: **Evaluation result** is the raw record (internal, never shown raw); **Insights** is the interpreted user-facing surface. An Evaluation result is *always* rendered into meaning — never a data wall. Audience bridge (§1) lives in the renderer, not the artifact.
- **rendered artifact vs. persisted row** — resolved: **Evaluation result** (ephemeral, on the seam) is distinct from **Evaluation record** (persisted, §6). Don't render straight from the DB row or persist the render.
- **what does the Evaluator own?** — resolved with the **method vs. resources** line. It owns its method (builds its own Scenario / distractor field / battery, runs the skill). It does not own resources (model + meter — handed in via the harness). Building its own conditions is intrinsic to *being* that evaluator (a triggering eval without a distractor field isn't one); extracting that would remove the evaluator's brain. The harness extraction stays because resources are shared + sensitive (the Anthropic key, the day-one meter); the method stays in because it *is* the capability. Consequence: no external `Input` parameter, no separate builder concept, no "environment" domain term.
