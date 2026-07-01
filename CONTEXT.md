# agent.branch — Domain Language

The ubiquitous-language contract for agent.branch: the canonical word for each
concept and the aliases to avoid. This is the *language* layer — `docs/ARCHITECTURE.md`
§2 carries the full definition and the *why*, and stays the source of truth for
both. When they overlap, this file sharpens the word; ARCHITECTURE carries the
rationale. Keep definitions there, not here.

## Language

**Skill**:
The product's unit of work — a reusable, instruction-only instruction set for a Claude agent. No bundled runnable code.
_Avoid_: prompt, agent, bot, automation

**`SKILL.md`**:
A skill's source file — YAML frontmatter (`name`, `description`) + markdown body. The lossless source a skill round-trips through.
_Avoid_: spec, config, manifest

**Skill record**:
A persisted skill in our DB — `SKILL.md` source plus identity and timestamps. Everything else is derived from it.
_Avoid_: skill row, skill entity, document

**Draft** (branching iteration, §9.3):
*User-facing term* for a working lineage of skill revisions that accumulates without moving the **main version** — the safe space to iterate and evaluate before committing. A skill may have several open at once. The internal/code term is `branch`.
_Avoid_: branch (code-only — never user copy), working copy, fork, sandbox

**Main version** (branching iteration, §9.3):
*User-facing term* for a skill's blessed, pinned version — what export, install, and the hero default to. One per skill; **promote** moves it. "Main" is *semantic* (the main one), not git's branch name.
_Avoid_: head, blessed (code-only), master, trunk, current (collides with the draft you're editing)

**Promote** (branching iteration, §9.3):
Internal/code term for moving the main pointer to a draft's head — a new head event (append-only), *replace-not-merge*, last-promote-wins. User copy is the button **"Set as main version"**.
_Avoid_: merge, rebase (no such operation exists — see §9.3), publish (reserved for the tap, §9.1), commit

**Build loop**:
The core agentic loop — Claude writes/edits the `SKILL.md` through `write_skill`/`edit_skill`, streaming to the preview. Closeable with **eval feedback**.
_Avoid_: chat, conversation, agent loop, generation

**Requirements interview**:
The build loop's initial flow — on a new skill, bounded plain-language questioning (the job, the moment, the walkthrough, boundaries, materials, failures) that gates the first `write_skill` behind a readiness checklist. Presses on scope: bundled jobs split into companion building-block skills. Happens once; revisions and eval feedback never restart it.
_Avoid_: intake form, questionnaire, onboarding, wizard (it's a conversation, not a form)

**Eval feedback**:
A formatted summary of an Evaluation result (or Lint artifact) injected as a user message into the build loop, so Claude revises from observed evidence rather than guessing. Produced by a **feedback formatter** — a pure function in the `build-loop` module.
_Avoid_: feedback loop (the pattern, not the artifact), revision prompt (doesn't name the source), eval summary (that's Insights — the user-facing surface)

**Skill-analysis seam**:
The architectural spine — the shared pattern *read input → emit a structured artifact → render it for a surface*. Built once; every capability plugs in, never a new pipeline.
_Avoid_: pipeline, service, the analyzer

**Analysis capability**:
A *static* capability on the seam — reads an input and derives a structured view. Pure, runs offline. Wraps an **Analyzer** (`analyze(input)`).
_Avoid_: render, view (those name the output, not the capability)

**Evaluation capability**:
A *dynamic* capability on the seam — runs an input through a model and observes its behaviour. Costs tokens, needs a model. Wraps an **Evaluator** (`evaluate(input, gateway)`) that owns its method, not its resources (see *Distinctions*).
_Avoid_: execution, validation (overloaded), check

**Artifact**:
The structured thing an analyzer emits before rendering, discriminated by a closed `kind`. One kind per capability.
_Avoid_: output, result, payload, IR (the IR is one artifact kind, not the category)

**Skill IR**:
*One* artifact kind, produced by Visualise — nodes + edges, each carrying a **source-span** back into `SKILL.md`. A Visualise concept, not the seam itself.
_Avoid_: graph, AST, model (it is not the whole seam)

**Evaluation result**:
The Artifact an Evaluation capability emits — the structured run-record plus an `insight`. Ephemeral, lives on the seam, *never shown raw*. Internal term; never user copy.
_Avoid_: report (smells like a data wall), results table, output, log

**Insights**:
*User-facing term* for the default rendered surface of an Evaluation result — plain language the user can act on. A pure renderer shapes the result's `insight` field; a **breakdown** renderer sits behind it for technical depth.
_Avoid_: report, results, test output, eval data

**Model gateway**:
The platform's *single, controlled, metered* entry to the model — its own module (`src/modules/model-gateway`). Exposes fine intent-level **primitives** (`classify`/`runAgent`/`generate`); every model call passes through it. Pure mechanism — it does not pick the provider/model or hold the key (that's the **model router**), and knows no capability kinds.
_Avoid_: harness (evaluation-narrow + banned jargon), engine (that's the portability transform), runner, the SDK, model provider (that's the raw `LanguageModel` port the gateway resolves through the router)

**Model router**:
The platform's *single* provider + model **selection** authority — its own module (`src/modules/model-router`), the layer beneath the gateway. Owns the provider registry, credentials (server-pool key + optional **bring-your-own override**), and the runtime-mutable active selection; resolves a `LanguageModel` per primitive. Pure *selection* mechanism, as the gateway is pure *metering* mechanism.
_Avoid_: gateway (that's the metered entry, not the selector), provider (the raw `LanguageModel`), config (selection is runtime, not just env)

**Gateway primitive**:
A single intent-level model operation on the gateway — three in v1: **`classify`** (one structured pick from a fixed choice set; returns the winning label or `null`, plus the model's own one-line rationale), **`runAgent`** (one metered agent turn — the gateway runs the loop, the caller supplies each tool's `handler`), **`generate`** (one metered free-form structured-output call, schema-validated). Fine, not capability-shaped — keeping primitives fine keeps **method** in the caller and the gateway fixed-size as callers multiply.
_Avoid_: tool, op, command, wouldSelect/runScenario (those are caller methods, not gateway primitives)

**Insight**:
The structured, plain-language interpretation of an Evaluation result — `{ verdict, summary, findings[], watch[] }`. The evaluator produces it via `gateway.generate` after its run and stores it on the result; the **Insights** renderer shapes it for display. Real model interpretation captured as data, not prose baked into a renderer.
_Avoid_: summary, analysis, explanation (those name parts of it), verdict (that's one field)

**Insight agent** (deferred, §9):
The richer future of insight-generation — a tool-using agent (`runAgent` + tools) that *investigates* a result before explaining it, replacing the bounded `generate` call without changing the `Insight` shape or the renderer. Reuses the seam across evaluation kinds.
_Avoid_: insight service, explainer (premature naming)

**Accounting tag**:
A label the *caller* declares on every gateway call — **`account`** (user-attributable, subject to tier policy) or **`platform`** (the platform's own cost to enable a feature, never charged to a user's allowance). An `account` tag also names the **capability** it spends on, because the cap is capability-specific. The gateway carries it to the **usage** module.
_Avoid_: billing flag, cost type, owner

**Usage** (accounting authority):
The module that decides "may this happen, and who pays" — tier caps (`checkCap`) and recording by **accounting tag**. Policy lives here; the gateway is mechanism.
_Avoid_: meter (too narrow — free tier isn't token-metered), billing, quota

**`cap_reached` vs `model_unavailable`**:
Two distinct members of the closed `DomainError` union. `model_unavailable` = no model configured (offline / no key). `cap_reached` = a model exists but the user hit a tier limit (the §8 graceful-degradation catch — "out of free usage today, back tomorrow"). Don't conflate them.
_Avoid_: (n/a)

**Evaluation record**:
The *persisted* row for an evaluation (`test_runs` / `eval_runs`, ARCHITECTURE §6) — append-only, has identity and lifetime. Distinct from the ephemeral Evaluation result (see *Distinctions*).
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
The v1 validation — does the skill *fire* on the right prompts and *stay silent* on the wrong ones? Run against a **distractor library** + a positive/negative **prompt battery**.
_Avoid_: trigger test, firing test, selection eval

**Scenario**:
The situation a test run runs against — `{ prompt, seedData }`, one per run in v1. Built by the test-run evaluator itself (generated to stress the skill), not handed in.
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
- An **Analysis capability** wraps an **Analyzer** (`analyze(input)`) — Artifact from the input's source.
- An **Evaluation capability** wraps an **Evaluator** (`evaluate(input, gateway)`) — it builds its own conditions and runs the input, emitting an Artifact. It owns its **method** (how it builds + runs its world); it does **not** own its **resources** (model access — handed in via the **model gateway**).
- The **model gateway** is the platform's single entry to the model. It exposes **gateway primitives** (`classify`, `runAgent`), carries a caller-declared **accounting tag**, and **depends on the usage module** for policy. The seam (and its evaluators) **depend on the gateway port**; the gateway is *not* part of the seam.
- **Usage** is the accounting authority: `account`-tagged calls are subject to tier policy (free = structural caps + provider cap-catch; paid = token stream, deferred), `platform`-tagged calls go to our own cost ledger (deferred). The gateway is mechanism, usage is policy.
- When no model is configured (offline / no key) the gateway can't run a primitive — an Evaluation capability fails with the shared `model_unavailable` **DomainError**, checked once in the seam's evaluation path, not in each evaluator. Analysis capabilities still run offline (pure text). This is evaluation's hard dependency that analysis doesn't have.
- **Visualise** is an Analysis capability whose Artifact is the **Skill IR**; each IR node carries a **Source-span**.
- A **Test run** drives the **Mock-tool registry**; a **Triggering eval** drives the **Distractor library** + **Prompt battery**. Both are Evaluation capabilities.
- An **Evaluation capability** emits an **Evaluation result** (the run-record Artifact), which renders to **Insights** (default, plain-language) and a detailed breakdown (depth on demand) — two renderers, one result.
- **Eval feedback** connects the seam's evaluation output back to the build loop's input: a feedback formatter (pure function in `build-loop`) translates an Evaluation result or Lint artifact into a user message. **Insights** is what the *user* reads; eval feedback is what *Claude* reads to author the revision. The same result serves both surfaces.
- An **Evaluation result** is ephemeral on the seam; it is persisted as an **Evaluation record** (§6). Analysis artifacts are never persisted — they recompute. The result is rendered *now*; the record is re-rendered *later*.
- The **Portability transform** is one engine feeding two surfaces (cross-provider validation, cross-primitive export) — both deferred in v1.

## Example dialogue

> **Dev:** "Export reads the skill and emits a `.zip` — that's the same shape as Visualise, right? Both analysis capabilities?"
> **Domain expert:** "Yes. Both read the text and render a view, no model loop. A **Test run** is the other shape — it *runs* the skill against the **mock-tool registry** and watches what happens. Same seam, but it's an **evaluation capability**, not an analysis one."
> **Dev:** "Does the test-run evaluator get handed the scenario to run?"
> **Domain expert:** "No — it builds its own **Scenario**. Building the world it runs in is its *method*, and that's what makes it the test-run evaluator. What it's handed is the **model gateway** — model access, metered — because that's a shared, sensitive **resource** it doesn't own. Method in, resource handed in."
> **Dev:** "But generating a scenario to stress the skill needs a model call."
> **Domain expert:** "Right — so it calls a **gateway primitive**, `runAgent` or `classify`. The gateway owns the key and the plumbing; the evaluator just expresses intent. And it tags that call `platform` — stressing *the* skill is us enabling the feature, not the user spending their allowance."
> **Dev:** "When would a call be tagged `account`?"
> **Domain expert:** "When the user drove it and it counts against their tier — the build loop's turns, their triggering eval against their battery. `account` goes through the **usage** policy; `platform` goes to our own cost ledger. The caller declares the tag because only it knows why it's spending."
> **Dev:** "Then it spits out the run data?"
> **Domain expert:** "It emits an **Evaluation result** — the raw run-record. That's never shown raw. It renders to **Insights**: plain language the user can act on. Same seam, evaluation side."
> **Dev:** "So when I add trigger-overlap detection later?"
> **Domain expert:** "Ask which shape first. It runs the skill against the user's other skills — that's evaluation. New `ArtifactKind`, evaluation shape, owns its method, handed the **gateway**, renders to Insights. It composes its method from `classify` — same primitive the triggering eval uses, different question. The gateway doesn't grow; your evaluator does."

## Distinctions to keep straight

The easy confusions, stated as rules. Each names a pair people collapse and the line that keeps them apart.

- **One seam, two shapes.** The `ArtifactKind` union mixes static views (`hero`, `skill-ir`, `export`) with dynamic executions (`test-run`, `triggering-eval`). They are one seam with two capability shapes — **Analysis** (static) and **Evaluation** (dynamic). Name the shape before picking analyzer + renderer.
- **Evaluation result ≠ Insights.** The raw run-record is the **Evaluation result** (internal, never shown raw); the interpreted, user-facing surface is **Insights**. A result is *always* rendered into meaning — never a data wall. The audience bridge (§1) lives in the renderer, not the artifact.
- **Evaluation result ≠ Evaluation record.** The result is ephemeral on the seam; the record is the persisted row (§6). Don't render straight from the DB row, and don't persist the render.
- **An Evaluator owns its method, not its resources.** It builds its own Scenario / distractor field / battery and runs the input (its method); model access is handed in via the **model gateway** (its resource). Building its own conditions is intrinsic to *being* that evaluator; the gateway stays out because the resource is shared + sensitive.
- **No "harness."** Model *mechanism* and accounting *policy* are two things: the **model gateway** (mechanism — owns the key, exposes `classify`/`runAgent`, knows no evaluation kinds) depends on the **usage** module (policy — caps + recording by tag). "Harness" is banned (also jargon). The gateway is a **platform** concern; evaluation is just its first consumer (portability transform, mock-data generation, the build loop follow).
- **Not all model spend is user-attributable.** The **accounting tag** splits it: `account` (user-attributable, tier policy) vs `platform` (the platform's own cost — e.g. generating mock data to stress a skill — never charged to a user's allowance). The caller declares the tag because only it knows *why* it's spending.
</content>
</invoke>
