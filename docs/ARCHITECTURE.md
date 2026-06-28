# agent.branch — Architecture

Single source of truth for **what we build and why** — product, system, services, data, **and** app/screen layout. All of it lives here because it's one *kind* of knowledge (decisions that translate into code), regardless of layer.

**Companion docs:**

- **`DESIGN.md`** — the *visual design system* (theme, color tokens, type scale, spacing, components).

---

## 1. Product thesis

**agent.branch is a skill *testing / CI* tool that also authors.** That is the long-term thesis, and it's the sharp end of the pitch — most tools stop at editing; the durable value is *validating* a skill before it ships.

In the near term it's a **visual authoring + lightweight-validation tool for agent skills**: build a skill in chat with a live-streaming preview, **visualise** its logic, **test-run** it, check its **triggering**, and **export** it. The frame is **Claude-first runtime, standard-native artifact**: authoring and validation run on Claude, and the skill the user owns is an [Agent Skills open-standard](https://agentskills.io) `SKILL.md` folder that installs as-is across compatible tools (Claude, Codex CLI, Gemini CLI, Copilot and more). **Honest portability** is the growth edge — validating *behaviour* on other runtimes' models, never a "runs everywhere" fidelity claim; the standard already solved the format question.

**Audience is a bridge, not just developers.** Two users:

- the **technical builder** — fluent in `SKILL.md`, YAML, trigger logic;
- the **non-technical SMB owner** — automating admin (inbox, scheduling, docs) with AI.

A skill is an inherently technical artifact (instructions + frontmatter + trigger logic), so the product's job is to make it *approachable without dumbing it down*: **one warm-pro identity, technical depth on demand, not in your face.** This is a positioning commitment, not just styling — it drives the hero's [Rendered/Source render model](#7-frontend--app-shell) and the whole `DESIGN.md`.

**v1 = a thin vertical slice across all capabilities, Claude-only.** The authoring loop ships polished; everything else ships thin. Full breadth, minimum depth.

---

## 2. Glossary — the domain language

One term per concept. Use these names everywhere — in docs, code, and UI copy.

| Term | Definition |
|---|---|
| **Skill** | The product's unit of work: a reusable instruction set for an AI agent, per the **Agent Skills open standard**. Instruction-only — no bundled runnable code. Claude is the first-class authoring and validation runtime; the artifact itself is standard-native and installs across compatible tools. |
| **`SKILL.md`** | The skill's source file (the open standard's format): YAML frontmatter (`name`, `description`) + markdown body (instructions, workflow, rules). |
| **Skill record** | The persisted skill in our DB (see [§6](#6-data-model-sketch)). Exports are rendered *from* it. |
| **Build loop** | The core agentic loop: Claude writes/edits the `SKILL.md` through the `write_skill`/`edit_skill` tools, streaming to the preview. Reaches the model only through the **model gateway** (`streamAgent`), so a build turn is gated + accounted like every other model call. The loop is *closeable* with evaluation and lint results: an **eval feedback** message can be appended to the conversation, giving Claude the specific failure cases and rationale it needs to make targeted revisions. |
| **Eval feedback** | A formatted summary of an **Evaluation result** (or **Lint** artifact) injected as a user message into the build loop conversation, so Claude can revise the skill against observed evidence rather than guessing. Produced by a **feedback formatter** — a pure function in the `build-loop` module that translates the structured artifact into actionable revision context. User-triggered from the **Insights** surface for evaluation results ("Revise with this feedback"); auto-injected after `write_skill` for lint findings. Distinct from **Insights** (the user-facing display surface) — Insights is what the user reads; eval feedback is what Claude reads to author the revision. |
| **Skill-analysis seam** | The architectural spine. The shared pattern **read input → emit a structured artifact → render it for a surface**. Built once; each feature is a new capability on it, not a new pipeline. Carries **two capability shapes** (below). Distinct from the skill IR: the seam is the pattern, the IR is one artifact type on it. Current concrete inputs are Skills; the `Analyzer<Input, A>` / `Evaluator<Input, A>` shape is ready for future equipment primitives. |
| **Analysis capability** | A *static* capability on the seam — derives a structured view from an input's source. Pure, runs offline. Wraps an `Analyzer<Input, A>` (`analyze(input)`). The Rendered/Source hero, Visualise, Lint and Export are analysis capabilities over `Skill` today. |
| **Evaluation capability** | A *dynamic* capability on the seam — **runs an input through a model** and observes behaviour. Costs tokens, needs a model (fails `model_unavailable` offline). Wraps an `Evaluator<Input, A>` (`evaluate(input, gateway)`) that **owns its method, not its resources**: it builds its own conditions (Scenario / distractors / battery) but model access is handed in via the **model gateway**. Test run and Triggering eval are evaluation capabilities over `Skill` today. |
| **Evaluation result** | The artifact an evaluation capability emits — the structured run-record. Ephemeral; **never shown raw**. Renders to **Insights** (and a detailed breakdown on demand). Distinct from the persisted **evaluation record** ([§6](#6-data-model-sketch)): the result is rendered now, the record is stored and re-rendered later. |
| **Insights** | The default, plain-language rendered surface of an evaluation result — meaning the user can act on, not a data wall. The audience bridge ([§1](#1-product-thesis)) lives in the *renderer*; a detailed breakdown sits behind it for depth (same Rendered/Source duality as the hero). |
| **Model gateway** | The platform's **single, controlled, metered entry to the model** — its own module. Owns the AI-SDK call plumbing; exposes fine intent-level primitives `classify`/`runAgent`/`streamAgent`/`generate` that callers compose into their own method. Pure mechanism — knows no capability kinds. It does **not** pick the provider/model or hold the key: it resolves a `LanguageModel` per call from the **model router**. Every call carries an **accounting tag** (`account` \| `platform`); the gateway routes accounting through the **usage** authority. Consumers: the build loop (via `streamAgent`) and evaluation. Cross-runtime validation and mock-data generation route through it next (future work). **Target state ([#34](https://github.com/CrowBe/agentbranch/issues/34), [#35](https://github.com/CrowBe/agentbranch/issues/35)):** as the one metered chokepoint, the gateway is also where input-size budgets, prompt caching (a frozen system prefix), and cache-aware token accounting are enforced and measured. |
| **Model router** | The platform's **single provider + model selection authority** — its own module, the layer beneath the gateway. Owns the **provider registry** (every provider the platform knows: Anthropic default, Nous Portal, extensible), their **credentials** (a server-pool key per provider, plus an optional **bring-your-own override** that wins when present), and the runtime-mutable **active selection** (which provider + model each primitive routes to). The gateway calls `resolve(primitive)` to get a `LanguageModel`; the **model console** drives the router's mutators so provider/model can be switched (or a key connected) at runtime, e.g. to rotate providers while testing the flow. Pure *selection* mechanism — knows no accounting or capability kinds. Per-capability routing (Opus for `streamAgent`, cheaper models for `classify`/`generate`) is expressed here as per-primitive model ids. Selection + bring-your-own keys are **process-local and single (not per-user)** in v1 — one shared active selection per instance, which suits the testing/rotation use case; per-user isolation + a persisted store is a future port + adapter swap. Keys never leave through its secret-free snapshot and are never logged. |
| **Accounting tag** | Declared by the *caller* on every model-gateway call: **`account`** (user-attributable, subject to tier policy) or **`platform`** (the platform's own cost to enable a feature — e.g. generating mock data — never charged to a user's allowance). Three accounting streams: free+account = structural caps + provider cap-catch (no token counting, [§8](#8-free-tier)); paid+account = token-spend stream (deferred); platform = our own cost ledger (deferred). A model call denied by a cap fails `cap_reached` (distinct from `model_unavailable` = no model at all). |
| **Skill IR** | *One specific* artifact type on the seam: visualise's intermediate representation — nodes + edges, each carrying a **source-span** back into `SKILL.md`. A visualise concept, not the whole seam. |
| **Test run** | User-facing term for executing a skill against **mocked** tools to see how it behaves. The mechanism is the **mock-tool registry**; the agent tool is **`execute_skill`**. Nothing real is ever touched. (Always "test run" in user copy — never "sandbox": jargon that intimidates rather than informs.) |
| **Mock-tool registry** | The mechanism behind a test run: when the skill calls a tool (e.g. "fetch unread email"), the registry returns generated mock data instead. The skill runs end-to-end against fake tools, so the user sees its behaviour without anything real happening. No code execution or containers — skills are instruction-only, so there's nothing to containerise. |
| **Triggering eval** | The v1 validation: does the skill *fire* on the right prompts and *stay silent* on the wrong ones? Run competitively against a **distractor library** + a positive/negative **prompt battery**. |
| **Cross-runtime validation** | The portability surface. Skills travel as-is under the open standard, so portability is a *behaviour* question, not a format one: one engine runs the skill's triggering battery against other runtimes' models (provider swap through the model gateway) and reports a per-runtime grid. Results are honest, model-level approximations of each tool's harness — copy says so. Deferred; target state ([#65](https://github.com/CrowBe/agentbranch/issues/65)). |
| **Rendered / Source view** | The hero's two views of the same skill. **Rendered** (default) = friendly sans-serif document. **Source** = raw `SKILL.md` monospace. Both are renderers on the seam. |

---

## 3. Core architecture — the through-line

A single **server-side agentic harness** (Vercel AI SDK + Claude) with a **tool registry**. Not N services — one agent loop, many tools.

```
Browser (React)  ──SSE──▶  Next.js route handler
       ▲                          │
       │ stream tool output       ▼
   preview / viz / chat     Build loop  ──streamAgent──▶  Model gateway ──resolve──▶ Model router
                                  │                      (metering + accounting)    (registry + creds
                                  ▼                              │                   + active selection)
                            Tool registry:                       ▼                          │
                              write_skill, edit_skill,     Claude / Nous (Vercel AI SDK) ◀──┘
                              visualise_skill, execute_skill,                  ▲
                              + mock-tool registry integrations          Model console (UI)
```

- The **model router owns the provider keys** + the active provider/model selection; the **gateway** owns metering + accounting. Nothing above the gateway (the build loop, the route handler) touches the raw model, the keys, or the client. The **model console** is the only surface that mutates the selection, through the gateway-adjacent router.
- Tool-call output streams to the client over **SSE**. Evaluation runs use the same transport for progress events and the final artifact.
- `execute_skill` runs against the **mock-tool registry** ([§2](#2-glossary--the-domain-language)): a test run, not real execution.

### 3.1 The skill-analysis seam (the spine)

Several capabilities are the **same shape**: *read an input → emit a structured artifact → render it for a surface*. Build the seam once; each feature plugs in without a new pipeline. Current concrete inputs are Skills; the generic `Input` slot is what lets future equipment primitives use the same seam.

The seam carries **two capability shapes** — same `artifact → render` tail, different head:

- **Analysis** (static) — derives an artifact from the input's source. Pure, runs offline. Wraps an `Analyzer<Input, A>` (`analyze(input)`). Its artifact is *recomputed on demand*, never persisted. Rendered hero, Source view, Visualise, Lint and Export all use `Skill` as their input today.
- **Evaluation** (dynamic) — produces an artifact by **running the input through a model**. Needs a model (fails `model_unavailable` offline), costs tokens. Wraps an `Evaluator<Input, A>` (`evaluate(input, gateway)`) that **owns its method, not its resources** — it builds its own conditions but is handed the **model gateway**, the platform's single metered entry to the model. It composes its method from the gateway's fine primitives (`classify`/`runAgent`); it never touches the raw model, the key, or token accounting. Its artifact (an **evaluation result**) is *persisted* as an evaluation record and renders to **Insights**. Test run and Triggering eval both use `Skill` as their input today.

> The split is named so a new capability is classified **before** it's built: "is this analysis or evaluation?" decides whether it gets an `Analyzer` or an `Evaluator`, runs offline or needs the harness, recomputes or persists. The seam stays one spine; the two heads keep the model dependency and token cost out of the pure analysis surfaces.

| Capability | Shape | Extract / run | Render (v1) | Render (later) |
|---|---|---|---|---|
| **Rendered hero** | analysis | frontmatter + body | friendly structured document (sans-serif) | richer doc layout / inline editing |
| **Visualise** | analysis | skill IR (nodes+edges+source-spans) | Mermaid | interactive canvas (React Flow) |
| **Lint** | analysis | frontmatter + body quality rules → `LintReport` | Insights (score/grade + actionable findings) + Breakdown (full finding list with source-spans) | per-primitive rule sets as new equipment types land |
| **Cross-runtime validation** | evaluation | run triggering battery on other runtimes' models → per-runtime results | — (deferred) | per-runtime results grid |
| **Test run** | evaluation | run skill vs. mock-tool registry → result | **Insights** (+ transcript on demand) | richer scenarios / multi-run |
| **Triggering eval** | evaluation | run skill vs. distractors + battery → result | **Insights** (+ pass/fail breakdown) | scored / workflow / regression |

This is what "build it flexible" means here: a **clean seam**, not a speculative v2 abstraction.

---

## 4. Decisions

Current choices and the reasoning behind them. Live — open to revision while we're still in flux.

| Branch | Decision | Why |
|---|---|---|
| Build loop | Claude on our key (Anthropic) via **Vercel AI SDK**, reached through the **model gateway** (`streamAgent`) | Skill primitive is Claude-tuned; routing through the gateway means build turns are gated + metered by the one accounting authority, like every other model call; one harness, provider-swappable at runtime via the router |
| Eval → build feedback | Evaluation results feed back into the build loop as **eval feedback** messages — a formatter in the `build-loop` module (not the eval modules) translates the structured artifact into a user message; the client appends it and re-submits | No new API, no new gateway primitives; the formatter lives in `build-loop` because "what does Claude need to revise this skill?" is a build-loop concern, not an evaluation concern; the high-value content for triggering eval is the failed cases with model rationale (the classifier's own explanation), not just the Insight headline |
| Provider/model routing | A standalone **model router** beneath the gateway owns the provider registry, credentials (server pool + bring-your-own override), and the runtime-mutable active selection; the **model console** switches it live | Splitting *selection/credentials* (router) from *metering* (gateway) keeps each pure; runtime switching lets us rotate providers/models to test the flow without redeploying, and bring-your-own keys layer on without breaking the server-owns-key default. Default selection still comes from env, so nothing changes for a plain boot |
| Model console access | The console + its route are **admin-gated** (an env allowlist of Clerk user ids / emails, checked by `isAdmin`): open on a no-auth dev box, admin-only when auth is configured, locked when auth is on but no allowlist is set | The selection is **instance-wide** in v1 (one shared active provider/model + keys), so a plain signed-in user must not change what everyone runs on. Fail-safe (deny without an allowlist) beats fail-open for a credential surface; per-user config is the heavier future path |
| Skill scope | **Instruction-only** (`SKILL.md` + reference docs); no bundled runnable code | A test run becomes a mock-tool registry, not a container — removes all code-exec/isolation infra |
| Write / edit | `write_skill({content})` streams the whole doc on first draft; `edit_skill({old,new})` applies a highlighted diff on revisions | Mirrors Claude Code's Write+Edit; cheaper tokens; preview is a doc model supporting replace+patch |
| Visualise | Model emits a **skill IR** (nodes+edges, each with a **source-span** into `SKILL.md`); v1 thin **IR→Mermaid** renderer; diagram type model-chosen; 1 generation | IR is the stable contract; the later canvas reuses it; node↔source mapping paid once |
| Test run — mock data | Fixed schema per integration; **contents generated to stress the skill**; cached per session for deterministic re-runs | Relevant to the user's real case; billable token cost; deterministic within a session |
| Test run — tool selection | Mock tools **auto-inferred** from the skill; user can override | One-click test; manual add for undetected tools |
| Triggering eval | **Lightweight** — does the skill fire on the right prompts, stay silent on the wrong ones? Mirrors Anthropic's skill-builder output | Cheapest eval, no judge model, tests the #1 failure mode (bad description/triggers) |
| Triggering eval — competition | User skill + **distractor library** (~10 → ~30) + positive **and** negative **prompt battery** | Skill selection is competitive; testing in isolation gives false confidence |
| Cross-runtime validation | **Honest behavioural check** — run the skill's triggering battery against other runtimes' models via provider swap through the model gateway; *not* format conversion, *not* "skills run everywhere" | The open standard makes the file portable everywhere; the open question is behaviour — "will my skill survive Codex/Gemini?" — and honesty is the better pitch |
| Export v1 | Copy button + **`.zip`** of the standard skill folder (`skillname/SKILL.md` + refs) | The standard folder is the one installable artifact across compatible runtimes — no per-target packages needed (every major tool consumes `SKILL.md` natively); copy serves the paste-it case |
| Authoring screen layout | **Preview-primary**: the streaming skill document is the hero; interaction is a **demoted control surface**, not a co-equal chat panel | The skill artifact is the product, not the conversation |
| Hero render mode | Hero has **two views: Rendered (default) + Source (toggle)** — see [§2](#2-glossary--the-domain-language). Default Rendered for newcomers; Source one click away | Bridge audience ([§1](#1-product-thesis)): raw monospace `SKILL.md` is the biggest "this is for programmers" signal. Rendered-default removes that wall without hiding the artifact. **Reuses the seam — Rendered is just another renderer**, so it's cheap |
| App shell | **Thin branded top bar** (chrome only, no nav links) + **left slideout menu** (all primary nav + account footer; collapsed icon rail by default, expands on demand) wrapping the hero + slim right interaction panel. Tool surfaces are **chips** on the hero header | Top bar stays clean framing; nav consolidated in the menu; hero gets max width by default |
| Stack | Next.js (App Router) + TS · Postgres via **Prisma 7** (pg driver adapter) · **Clerk** auth (Google+GitHub) · Vercel AI SDK (Claude default, optional Nous Portal) · SSE · Vercel + Neon/Supabase | One language end-to-end; fastest empty-repo-to-deployed; the build loop streams from a route handler, reaching the model through the gateway that holds the key |
| Billing v1 | **Subscription tiers** (Free / Pro) via Clerk Billing; token meter built day one; PAYG/overage via Stripe Billing Meters later | Clerk PAYG not GA (mid-2026); the meter exists anyway for caps; reuse it for PAYG later, honour transparent margin then |
| Free-tier aggregate cost | **Provider-side spend/rate cap** (Anthropic Console); app **catches the limit-hit response** → flips free sessions to "out of free usage today, back in X" | Provider is source of truth; a catch (not a predictive counter) avoids double-accounting and fails safe |

---

## 5. v1 thin-slice spec (per capability)

The build loop is **not thin** — it's the core and must feel good. Everything else is the minimum that proves the shape.

1. **Auth + meter** — Clerk (Google+GitHub), Postgres, per-turn + per-token counter. Thin = no admin UI, enforced caps only.
2. **Build loop** — Claude via the model gateway's `streamAgent`; `write_skill`/`edit_skill`; SSE to preview. **Polished, not thin.** Closeable with **eval feedback** — triggering-eval and test-run Insights feed back as messages, giving Claude the failure cases and rationale to make targeted revisions.
3. **Lint** — pure analysis, zero tokens, uncapped; auto-runs on every version after `write_skill`. Insights + Breakdown renderers. The seam's `Analyzer<Input, A>` design makes lint rule sets portable to future equipment primitive types.
4. **Import** — paste `SKILL.md` text or import a public GitHub skill URL; same parse → persist → render path as authored skills.
5. **Visualise** — model emits skill IR; thin IR→Mermaid renderer; 1 generation; no diagram editing.
6. **Test run** — single run, 1 generated scenario, mock-tool registry with 1–2 mock integrations (email first), Claude only.
7. **Triggering eval** — small distractor library (~10), small prompt battery, "did it fire?" boolean. No judge model yet.
8. **Export** — copy + the standard skill folder `.zip`.
9. **Cross-runtime validation** — **stubbed** (engine designed, not built; [#65](https://github.com/CrowBe/agentbranch/issues/65)).
10. **Billing** — Clerk subscription tiers (Free + one Pro), gating capabilities 6/7. Thin = no PAYG.

---

## 6. Data model (sketch)

- **`users`** — identity from Clerk (Google/GitHub).
- **`skills`** — `id, user_id, name, description, body, frontmatter_json, created_at`.
- **`skill_versions`** — append-only revisions of a skill (export is a pure function of a version; enables future regression evals). Versioning is a product concept: restore-a-version lands as a *new* head revision (append-only stays append-only). Today's model is **linear latest-head**: the blessed version is implicit (`max(revision)`), and retention keeps the latest 10 versions per skill; older versions are pruned, and stored run records survive because their version foreign keys are nullable with `onDelete: SetNull`. **Target state ([#128](https://github.com/CrowBe/agentbranch/issues/128)):** versioning moves to **draft / main / promote** ([§9.3](#93-branching-iteration--draft-main-version-promote)). The schema delta is three moves: (1) an **explicit main-version pointer** on `skills` — today's blessed version is implicit as newest revision; branching makes it explicit and independent of newest, because a draft appends higher revisions *without* becoming main; (2) a **branch discriminator + parent pointer** on `skill_versions` so drafts chain as a DAG (*main is just a branch* — one branch flagged blessed), which retires the per-skill monotonic `revision` + `@@unique([skill_id, revision])` to a per-draft display ordinal; (3) **promote** as a new head event that re-points main (append-only preserved, structurally the same move as today's restore). Retention moves **off the write path** to a **daily cleanup job** (a new retention port + a scheduled trigger): it enforces latest-N-per-draft depth *and* an **open-drafts-per-skill cap**, and never prunes the main lineage or an open draft's tip. Run records pinned to a draft version still survive via `onDelete: SetNull`.
- **`usage`** — per-user token + turn counters (drives caps now; drives PAYG metering later).
- **`eval_runs`** / **`test_runs`** — recorded triggering-eval and test-run results. Each run carries a nullable `skill_version_id` pinning the result to the revision it evaluated; `onDelete: SetNull` lets stored runs survive version pruning. List/fetch APIs plus My skills / History surfaces re-render stored records through the seam renderers. Regression comparison is still deferred.

**Persistence invariants.** All DB access goes through Prisma's query builder — **no raw SQL anywhere**, so stored skill content can never become a SQL payload (parameterized-only). ESLint bans raw SQL calls unless a reviewed exception is added. Row ownership is enforced *in the query* (`where: { id, userId }`) for user-owned records rather than only re-checked in callers. **Target state ([#34](https://github.com/CrowBe/agentbranch/issues/34)):** `frontmatter_json` bounded (size / depth / key-count) with unsafe keys (`__proto__`, `constructor`) rejected on parse. Skill content and prompts are never written to logs.

Export shapes are **rendered from** the skill record — the schema is export-agnostic.

---

## 7. Frontend / app shell

Presentation-layer architecture — same kind of decision as the rest of this doc (it determines components, shell, routing), so it lives here.

**The shell:**

- **Thin branded top bar** — hamburger + mark + free-tier status chip. No nav links (chrome only).
- **Left slideout menu** — all primary nav (Build / My skills / History / Templates) + account in the footer. Defaults **collapsed** to a 56px icon rail for max hero width; expands to a 240px labelled slideout on demand. First-run needs a one-time hint so the expandability is discoverable.
- **Hero** — centred streaming skill document with **tool chips** on its header. Chip → tool mapping:

  | Chip | Backed by | Glossary term |
  |---|---|---|
  | **Visualise** | `visualise_skill` | skill IR → Mermaid |
  | **Run** | `execute_skill` | test run |
  | **Triggers** | triggering-eval runner | triggering eval |
  | **Export** | export renderer | standard skill folder `.zip` |

  **Two views via a header toggle:** *Rendered* (default, friendly sans-serif document) and *Source* (raw monospace `SKILL.md`). Streaming reads as *a document assembling itself* in Rendered, *code being typed* in Source. Default Rendered for the SMB first impression; Source for power users.
- **Right** — slim 300px interaction panel (typed drawer now; collapses to a floating voice-forward control when realtime voice lands — see [§9](#9-deferred-features--their-seams)).

**Why preview-primary:** the skill artifact is the product; the conversation merely nudges it. A fat chat transcript is the wrong frame — and actively wrong once voice is the input. The hero is the document; chat is a thin control surface beside it.

---

## 8. Free tier

- **OAuth-only** signup (Google + GitHub) — no passwords, no password-storage liability, raises per-account scripted-abuse cost.
- **One** skill-building session per account, naturally bounded by the **context window + a turn cap** → per-account spend is bounded by construction.
- Includes: 1 skill (**built or imported** — import is free by construction: paste / GitHub URL costs no model tokens, and it's the acquisition wedge, [#66](https://github.com/CrowBe/agentbranch/issues/66)), the **lint report** (pure analysis, zero tokens, uncapped), 1 visualisation, 1 **test run** (+ its generated scenario). **No triggering evals.**
- Structural bounds extend to import's non-model costs: a per-account **skill-count cap** (the "1 skill" above, one tunable constant) and a per-user **rate limit on import fetches** ([#73](https://github.com/CrowBe/agentbranch/issues/73)).
- Export: copy + the standard skill folder `.zip`.
- Aggregate protection: provider-side cap + the graceful-degradation catch (see [§4](#4-locked-decisions)).

---

## 9. Deferred features & their seams

Designed-for, not built. Each reuses an existing seam, so it's a renderer/config swap — not a new pipeline. The two principles worth stating explicitly:

- **The skill-analysis seam is the spine** — visualise, the Rendered hero, export, lint, and triggering evals all plug into it. New capabilities should ask "what input, artifact, and renderer is this?" before "what service is this?"
- **Cross-runtime validation is an evaluation capability on the seam** — a provider swap inside one engine, not a parallel pipeline.

**Deferred capabilities:**

- **Branching iteration** — move versioning from a linear latest-head model to safe-space iteration: a user edits and evaluates a **draft** without disturbing the version they trust, then **sets the draft as the main version** when satisfied. Several drafts can be open at once, so an un-promoted draft from a prior session is never stranded. Borrows git's *shape* without forcing git vocabulary onto the SMB-facing UI. Tracked with the primitives expansion ([#126](https://github.com/CrowBe/agentbranch/issues/126)) — the iteration substrate lands first. Full design in [§9.3](#93-branching-iteration--draft-main-version-promote).
- **Cross-runtime validation** (does the skill trigger/behave on Codex/Gemini-class models?) — the existing triggering battery run via provider swap through the model gateway; per-runtime results grid ([#65](https://github.com/CrowBe/agentbranch/issues/65)).
- **Interactive visualise canvas** ("Claude design"-style point-and-annotate) — IR→React Flow renderer; **point-and-annotate falls out for free**: node → its source-span → inject that span as precise context into the next chat turn.
- **Richer evals** — workflow evals (run the full loop, LLM-as-judge against rubrics) → regression evals (pin a scenario set, track score across edits = the retention hook).
- **Insight agent** — today each evaluation produces its **Insight** (the plain-language interpretation rendered as Insights) from one bounded `generate` call. The richer future is a tool-using agent (`runAgent` + tools) that *investigates* a result — re-runs cases, inspects the skill — before explaining it. Cross-cutting: it would explain *any* evaluation kind, reusing the seam, and replaces the `generate` call without changing the `Insight` shape or the renderer.
- **Skill tap** (publish + Skill library) — a public installation source other tools add once and install from. Moderation must precede distribution — full design in [§9.1](#91-skill-tap--moderation-before-distribution) ([#133](https://github.com/CrowBe/agentbranch/issues/133)).
- **Own-portfolio collision detection** — once accounts hold many skills, eval a new skill against the user's existing ones for trigger overlap.
- **PAYG / metered overage** — Stripe Billing Meters on the existing token meter; transparent margin. Pairs with **separate Anthropic keys/workspaces per tier** the moment paid users exist, so free-tier exhaustion can't block paying customers.
- **Realtime voice interaction** — the interaction surface evolves from the slim typed drawer (v1) to a floating **voice-forward control** (mic primary, typing fallback, no transcript column). Preview-primary was chosen so this is an *evolution, not a rework*; v1 UI choices must not block it. Slim drawer will stay as rendered transcript even in v2.

### 9.1 Skill tap — moderation before distribution

Designed, not built ([#133](https://github.com/CrowBe/agentbranch/issues/133)). **This design gates the tap: no tap code lands until the moderation system exists** — shipping a distribution source without it is a reputational one-way door. "Tap" (an installation source you add once, then install from by name) is the internal term; user-facing copy says **Publish** / **Skill library**. A tap is *distribution*, not deploy: a validated skill gets a public address, nothing runs.

**Threat model.** Skills carry no code, but that bounds *our* platform, not the consumer's runtime — a published `SKILL.md` installs into agents holding shells, browsers, and credentials. Model a skill as **a program whose interpreter is an LLM**. Classes: (1) **direct malicious instructions** (the skill is the payload, the host agent the executor); (2) **agent hijacking** — overriding the host's guardrails; (3) **trigger hijacking** — a deceptive `description` fires the skill where it has no business, the tap-specific risk since the standard selects on descriptions; (4) **latent payloads** — benign on read, malicious on a date/keyword/fetched URL; (5) **reference-file smuggling** — every gate layer reads the whole folder, not just `SKILL.md`; (6) **typosquatting / impersonation**. Hard limit, accepted: class 4 isn't solvable by review — anything checked once is defeated by indirection. The countermeasure is *content policy*: instructing the agent to fetch-and-follow remote instructions is a hard lint failure. We narrow what a published skill may do in exchange for being able to reason about it.

**The gate is the seam** — agent.branch is a validation tool that also distributes, not a file host bolting moderation on. Publication reuses the seam: **skill lint** carries the static policy rules (shell-exec patterns, credential paths, fetch-and-follow indirection, obfuscation); the **triggering eval**'s negative battery gains adversarial prompts, making it the trigger-hijack scanner; the **test run** catches behaviour the text hides (exfiltration-shaped tool calls show in the transcript); and a new **`safetyReviewCapability`** — an LLM-judge evaluation capability, `platform`-tagged — reads the full folder and scores injection/exfiltration/deception. The judge is **structurally untrusted**: it reads the skill strictly as data, and its verdict is a backstop, never the sole gate.

**Tiered visibility — automated gate for existence, humans for amplification.** Moderation cost scales with what we promote, not with volume:

| Tier | Bar | Reach |
|---|---|---|
| **Private** | — | Default; owner only (status quo). |
| **Community** | Automated gate passed (lint policy + adversarial battery + test run + safety review) | In the tap, link-reachable, installable. Labelled: *"community skill — automated checks passed, not human-reviewed"*. |
| **Reviewed** | Community **+ human review** | Surfaced: search, Templates, featured. What we vouch for. |

Supporting policy: publishers are attributable (OAuth-only identity, already true); publish pins an append-only skill version + **content hash** (the thing reviewed is provably the thing served; new version = new gate run); publish attempts are **rate-limited** via the existing per-capability windows (the gate spends platform tokens — itself an abuse surface); slugs live under the publisher's handle (`owner/skill-name`), removing most squatting value.

**The tap is a public git repo — review in the open.** The repo carries a `.claude-plugin/marketplace.json` (add once in Claude Code, install by name) and **is the publication mechanism**, Homebrew-style: publish = bot PR adding the rendered standard skill folder pinned to a version + hash; the **lint policy rules run as open-source CI in the tap repo itself** (lint is pure and zero-token, so it's extractable — anyone can read, re-run, and propose rules); the hosted evaluation layers post verdicts to the PR as status checks — hosted, but visible; merge on green = community tier; the **reviewed** tier is a curated index changed only by human-approved PRs, so vouching is itself a public, attributable diff; **takedown = revert at HEAD** (installs read HEAD, so a revert ends installability immediately), with reports via repo issues and an in-app path. Accepted residuals, named: git history persists (revert immediately, purge via host support for confirmed malware — tolerable for instruction text where it wouldn't be for binaries), and the static rules are public (attackers can test offline; transparency buys more trust than the obscurity protects — the model-based layers stay hosted and adaptive, so public rules are the floor, not the gate).

**Consumer-side honesty.** We can't make another runtime safe and the standard has no permissions manifest. At the install boundary we surface what analysis can derive: the skill's tool/behaviour footprint, trust tier, gate results, content hash. Presentation, never a guarantee — copy says so.

**Build order (when greenlit) — moderation leads, distribution follows:** 1. lint policy rules (useful to every author today, tap or no tap) → 2. adversarial battery → 3. `safetyReviewCapability` → 4. publication domain (pinned version, slug, tier, hash, rate limit) → 5. tap repo + bot (PR flow, open-source lint CI, hosted-gate checks, auto-merge, revert path) → 6. reviewed tier + Skill library surface (Templates becomes a view over the reviewed tier).

### 9.2 Equipment primitives & composition (broadening beyond Skill)

Tracked in [#126](https://github.com/CrowBe/agentbranch/issues/126) (paired with branching iteration, [§9.3](#93-branching-iteration--draft-main-version-promote); first composition only — later primitives stay designed-not-built). The seam is built so `Skill` is the *first* concrete input, not the only possible one: `Analyzer<Input, A>` / `Evaluator<Input, A>` take a generic input ([§2](#2-glossary--the-domain-language), [§3.1](#31-the-skill-analysis-seam-the-spine)). Broadening the product means adding more **equipment primitives** — declarative artifacts that change what an agent can do, know, decide, or safely access — each with its own source model, analyzer/lint, renderer, and optionally an evaluator, all on the existing seam (no new pipeline).

The broadening earns its keep only when a **second** primitive ships and **composition** becomes possible: cross-primitive evaluation questions the single-primitive product can't ask —

- Does this Skill call this Tool correctly?
- Does the Tool's output match the Response schema?
- Does the Skill stay inside the declared Policy?

Composition is **additive on the seam** — an evaluator gets richer input context, it does not become a new pipeline.

**Primitive order (each earns the next):**

1. **Response schemas** — structured output definitions (JSON Schema / typed shapes). Cheapest first step: pure lint is immediately useful, validates deterministically, and feeds Tool inputs/outputs and eval expectations. No runtime orchestration.
2. **Tool contracts** — typed input/output plus descriptions, examples, failure modes, safety notes. Enables the first relational evaluation; the first relational test extends **Test run** so a Skill calls a mocked Tool contract and the call arguments/output shape are validated.
3. **Policies / guardrails** — declarative constraints on allowed actions, confirmations, and data/network/file/output access. Lint catches obvious violations; evaluation tests whether the constraint holds under pressure.
4. **Agent profiles** (later) — durable identity + defaults (system prompt, role, tone, model preference, default equipment). Analysis is easy; the evaluation half needs rubric / LLM-judge support.
5. **Knowledge packs** (later) — bounded reference knowledge, lightweight RAG-adjacent, no vector DB. Meaningful only when evaluated as part of a profile + skill + tool bundle.

Supporting work on the way: **user-authored test materials** (let users seed Triggering eval / Test run with their own positive/negative prompts and scenarios — extends existing evaluators before becoming a top-level primitive) and **regression comparison** across evaluation records ([§6](#6-data-model-sketch); Richer evals above) so a revision's improvement or regression is visible.

**Smallest useful composition** — the bar for being more than a single-primitive tool: *here is a Skill, a Tool contract, and a Response schema; does the Skill call the Tool correctly and produce valid output?* Broader than single-primitive validation without dragging in container runtime, vector DBs, or subagent routing — the **non-goals for the first expansion**.

### 9.3 Branching iteration — draft, main version, promote

Designed, not built ([#128](https://github.com/CrowBe/agentbranch/issues/128) — the iteration substrate for [#126](https://github.com/CrowBe/agentbranch/issues/126), lands before the primitives ride on it). Moves versioning from linear latest-head to a **draft / main / promote** model so a user can iterate and evaluate without disturbing the version they trust.

**The model.** A skill has one **main version** — the blessed pin everything defaults to (export, install, the hero's first paint). Iteration happens on a **draft**: a lineage of revisions that accumulates *without moving the main pointer*. The user evaluates the draft (lint, test run, triggering eval all run against the draft's head, not main), and when satisfied **sets it as the main version** — promote moves the pin to the draft's head. A skill may carry **several open drafts at once**: a new build session forks a fresh draft off main or resumes an open one, so an un-promoted draft from a prior session is never stranded and never silently becomes main. This is what made multiple drafts the call over a single draft slot — a one-draft model forces a stale/resume/discard decision the moment a second session starts; coexisting drafts remove that state machine.

**Git shape, stated precisely.** Internally, *main is just a branch* — every version belongs to a branch, one branch is flagged the blessed/main lineage via an explicit pointer, and promote re-points it. Versions chain by **parent pointer** (a DAG), so two drafts advancing independently never collide — this is why the linear monotonic `revision` demotes to a per-draft display ordinal ([§6](#6-data-model-sketch)). **Promote is replace-not-merge:** setting a draft as main repoints the pin to that draft's head; it is *last-promote-wins* with no three-way merge. Instruction-only skills carry no merge-conflict semantics worth solving, so a draft based on a now-superseded main stays a valid draft the user can re-promote (overwriting) or discard. **No merge, no rebase** — the accepted simplification that keeps the SMB model a single verb.

**Draft ≠ session.** The draft is the durable artifact; a build session is ephemeral. A session records which draft it last touched (for resume), but a draft outlives its session — there is no session entity ([§6](#6-data-model-sketch)), so resume is a pointer, not a lifecycle.

**Copy contract — git shape, not git vocabulary.** User-facing nouns and verbs: a branch is a **draft**; the blessed version is **the main version**; promote is the button **"Set as main version"** ("main" is *semantic* — the main one — not git's branch name). The internal/code terms `branch` and `promote` never reach user copy, the same internal-vs-surface split as mock-tool registry / test run and tap / Publish ([§9.1](#91-skill-tap--moderation-before-distribution)). **"Publish" is reserved for the tap** — where a skill genuinely becomes visible to others — and must not be reused for promote, which changes nothing's visibility.

**Retention is a daily tidy, not an inline cap.** Pruning moves off the write path (no prune inside a save/promote transaction) to a **fixed-cadence cleanup job**, which the UI can state plainly ("older drafts are tidied up daily; we keep your last N per draft and your main version"). The job enforces two axes, neither during a live session: **per-draft history depth** (latest-N-per-draft) and a structural **open-drafts-per-skill cap** (one tunable constant, the same bounded-by-construction shape as the free-tier skill-count cap, [§8](#8-free-tier)). It **never prunes the main lineage or any open draft's tip** — only interior history beyond N. Moving retention off the write path also dissolves the "don't prune an in-flight draft out from under the user" hazard *by construction*: nothing is pruned while a session is live. Schema delta + the retention port live in [§6](#6-data-model-sketch).

**On the seam.** Branching is **upstream of the skill-analysis seam**, not a capability on it: it changes *which `SkillSource`* feeds an analyzer/evaluator, never the seam's `artifact → render` shape. No new `ArtifactKind`, no renderer change — every capability (hero, lint, visualise, export, test run, triggering eval) runs against a draft head exactly as it runs against main today. The substrate is therefore a **port + adapter** change (MODULE_DESIGN §6 rule 2) on the existing `SkillRepository` plus one new retention port — not a new pipeline.

---
