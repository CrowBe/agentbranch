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
A *dynamic* capability on the seam — runs the skill through a model and observes its behaviour. Non-deterministic, costs tokens. Test run and Triggering eval are evaluation capabilities. An Evaluator **owns its method, not its resources**: it builds its own conditions (Scenario / distractor field / Prompt battery) and runs the skill, but model access is handed in via the **model gateway**. Its signature is `evaluate(skill, gateway)` — no external input parameter; the evaluator constructs its own world, calling the gateway when its method needs a model.
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

**Model gateway**:
The platform's *single, controlled* entry point to the model — its own module (`src/modules/model-gateway`). Owns the Anthropic key and the AI-SDK plumbing; exposes **fine intent-level primitives** (`classify`, `runAgent`) that callers compose into their own method. Every model call in the platform passes through it. It is pure *mechanism* — it knows nothing about "selection", "scenario", or any evaluation kind. Consumers: evaluation (now), portability transform + mock-data generation + the build loop (later). Depends on the **usage** module for accounting policy; the caller declares an **accounting tag** on each call.
_Avoid_: harness (evaluation-narrow + banned jargon), engine (that's the portability transform), runner, the SDK, model provider (that's the raw `LanguageModel` port the gateway wraps)

**Gateway primitive**:
A single intent-level model operation on the gateway. Two in v1:
- **`classify({ prompt, choices })`** → `Result<{ choice: string | null, rationale: string }>`. One structured single-shot pick. `choice` is the winning label or `null` (nothing fit). `rationale` is the model's *own* one-line reason, captured — not an invented confidence number (a chat model can't honestly give one). Triggering eval composes "would this skill fire, vs. the distractors?" from it (candidate + distractors are the `choices`; `null` = stayed silent), and `rationale` feeds Insights' *why*.
- **`runAgent({ system, messages, tools })`** → `Result<{ transcript }>`. One metered agent turn. The **gateway runs the loop**; each `tool` carries a caller-supplied `handler(input) → output`, so on a tool call the gateway invokes the caller's handler — loop is mechanism, tool *behaviour* is the caller's method. Test run passes handlers backed by its mock-tool registry. The gateway **records token usage internally** against the accounting tag (via the usage dep); the transcript comes back, tokens do not — the evaluator never touches them.

Fine, not capability-shaped: keeping primitives fine is what keeps **method** in the caller and the gateway fixed-size as callers multiply.
_Avoid_: tool, op, command, wouldSelect/runScenario (those are caller methods, not gateway primitives)

**Accounting tag**:
A label the *caller* declares on every gateway call — **`account`** (user-attributable work, subject to tier policy) or **`platform`** (the platform's own cost to enable a feature, never charged to a user's allowance). The caller declares it because only the caller knows *why* it is spending. The gateway carries the tag to the **usage** module, which applies the matching accounting stream.
_Avoid_: billing flag, cost type, owner

**Usage** (accounting authority):
The module that decides "may this happen, and who pays" — tier caps (`checkCap`), and recording by **accounting tag**. Three streams: **free + account** = structural caps (one session, turn cap, capability allowlist) + a *catch* of the provider-side aggregate cap (no per-token counting — provider is source of truth, ARCHITECTURE §4/§8); **paid + account** = a token-spend stream (deferred, §9 PAYG); **platform** = our own cost ledger (deferred), separate from any user's allowance. Policy lives here; the gateway is mechanism.
_Avoid_: meter (too narrow — free tier isn't token-metered), billing, quota

**v1 accounting behaviour** (thin slice): the tag is carried day-one so adding streams later is no reshape, but only the live path is built. `account` calls run `checkCap` (structural caps — the existing logic); `paid`-token-stream and the `platform` ledger are **deferred** — those tags are carried and otherwise no-op. A model call denied by a cap fails with **`cap_reached`** (distinct from `model_unavailable`): `model_unavailable` = no model configured (offline / no key); `cap_reached` = there *is* a model but the user has hit a tier limit (the §8 graceful-degradation catch — "out of free usage today, back tomorrow"). Both are members of the closed `DomainError` union.
_Avoid_: (n/a — internal thin-slice note)

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
The situation a test run is run against — `{ prompt, seedData }`, one per run in v1 (ARCHITECTURE §4). Built by the test-run evaluator itself (generated to stress the skill, so generation calls the **model gateway** — tagged `platform`, since stressing *the* skill is feature enablement, not the user's allowance), not handed in.
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
- An **Evaluation capability** wraps an **Evaluator** (`evaluate(skill, gateway)`) — it builds its own conditions and runs the skill, emitting an Artifact. It owns its **method** (how it builds + runs its world); it does **not** own its **resources** (model access — handed in via the **model gateway**).
- The **model gateway** is the platform's single entry to the model. It exposes **gateway primitives** (`classify`, `runAgent`), carries a caller-declared **accounting tag**, and **depends on the usage module** for policy. The seam (and its evaluators) **depend on the gateway port**; the gateway is *not* part of the seam.
- **Usage** is the accounting authority: `account`-tagged calls are subject to tier policy (free = structural caps + provider cap-catch; paid = token stream, deferred), `platform`-tagged calls go to our own cost ledger (deferred). The gateway is mechanism, usage is policy.
- When no model is configured (offline / no key) the gateway can't run a primitive — an Evaluation capability fails with the shared `model_unavailable` **DomainError**, checked once in the seam's evaluation path, not in each evaluator. Analysis capabilities still run offline (pure text). This is evaluation's hard dependency that analysis doesn't have.
- **Visualise** is an Analysis capability whose Artifact is the **Skill IR**; each IR node carries a **Source-span**.
- A **Test run** drives the **Mock-tool registry**; a **Triggering eval** drives the **Distractor library** + **Prompt battery**. Both are Evaluation capabilities.
- An **Evaluation capability** emits an **Evaluation result** (the run-record Artifact), which renders to **Insights** (default, plain-language) and a detailed breakdown (depth on demand) — two renderers, one result.
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

## Flagged ambiguities

- **"seam" used flat** — the code's `ArtifactKind` union mixes static views (`hero`, `skill-ir`, `export`) with dynamic executions (`test-run`, `triggering-eval`). Resolved: one seam, two capability shapes — **Analysis** (static) and **Evaluation** (dynamic). Naming the shapes tells a future author which one a new capability is before they pick analyzer + renderer.
- **"the run results" used to mean two things** — the raw run-record vs. what the user sees. Resolved: **Evaluation result** is the raw record (internal, never shown raw); **Insights** is the interpreted user-facing surface. An Evaluation result is *always* rendered into meaning — never a data wall. Audience bridge (§1) lives in the renderer, not the artifact.
- **rendered artifact vs. persisted row** — resolved: **Evaluation result** (ephemeral, on the seam) is distinct from **Evaluation record** (persisted, §6). Don't render straight from the DB row or persist the render.
- **what does the Evaluator own?** — resolved with the **method vs. resources** line. It owns its method (builds its own Scenario / distractor field / battery, runs the skill). It does not own resources (model access — handed in via the **model gateway**). Building its own conditions is intrinsic to *being* that evaluator (a triggering eval without a distractor field isn't one); extracting that would remove the evaluator's brain. The gateway extraction stays because the resource is shared + sensitive (the Anthropic key); the method stays in because it *is* the capability. Consequence: no external `Input` parameter, no separate builder concept, no "environment" domain term.
- **"harness = model + meter" was two things** — resolved during (b). The old **Evaluation harness** conflated *model mechanism* with *accounting policy*. Split: the **model gateway** (own module, mechanism — owns the key, exposes `classify`/`runAgent`, knows no evaluation kinds) *depends on* the **usage** module (policy — caps + recording by accounting tag). "Harness" is retired (also banned jargon). The gateway is a **platform** concern, not an evaluation one — evaluation is just its first consumer (portability transform, mock-data generation, the build loop follow). Fine primitives (not coarse `wouldSelect`/`runScenario`) keep the method/resources line honest and the gateway fixed-size as callers multiply.
- **can all model spend be attributed to a user?** — no. Resolved with the **accounting tag**: `account` (user-attributable, tier policy) vs `platform` (the platform's own cost to enable a feature — e.g. generating mock data to stress a skill — never charged to a user's allowance). Three accounting streams: free+account = structural caps + provider cap-catch (no token counting, §4); paid+account = token-spend stream (deferred); platform = our cost ledger (deferred). The *caller* declares the tag because only it knows why it's spending.
