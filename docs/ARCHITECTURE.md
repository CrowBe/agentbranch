# SkillBuilder — Architecture

Single source of truth for **what we build and why** — product, system, services, data, **and** app/screen layout. All of it lives here because it's one *kind* of knowledge (decisions that translate into code), regardless of layer.

**Companion docs:**

- **`DESIGN.md`** — the *visual design system* (theme, color tokens, type scale, spacing, components).

---

## 1. Product thesis

**SkillBuilder is a skill *testing / CI* tool that also authors.** That is the long-term thesis, and it's the sharp end of the pitch — most tools stop at editing; the durable value is *validating* a skill before it ships.

In the near term it's a **visual authoring + lightweight-validation tool for Claude Skills**: build a skill in chat with a live-streaming preview, **visualise** its logic, **test-run** it, check its **triggering**, and **export** it. **Claude-ecosystem-first**, with **honest portability** to other AI tools (ChatGPT/Gemini/Grok) as the growth edge — *not* a "runs everywhere" fidelity claim.

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
| **Skill** | The product's unit of work: a reusable instruction set for a Claude agent. Instruction-only — no bundled runnable code. |
| **`SKILL.md`** | The skill's source file: YAML frontmatter (`name`, `description`) + markdown body (instructions, workflow, rules). |
| **Skill record** | The persisted skill in our DB (see [§6](#6-data-model-sketch)). Exports are rendered *from* it. |
| **Build loop** | The core agentic loop: Claude (via Vercel AI SDK) writes/edits the `SKILL.md` through the `write_skill`/`edit_skill` tools, streaming to the preview. |
| **Skill-analysis seam** | The architectural spine. The shared pattern **read skill → emit a structured artifact → render it for a surface**. Built once; each feature is a new *renderer* on it, not a new pipeline. Carries **two capability shapes** (below). Distinct from the skill IR: the seam is the pattern, the IR is one artifact type on it. |
| **Analysis capability** | A *static* capability on the seam — derives a structured view from the skill's **text alone**. Pure, runs offline. Wraps an `Analyzer` (`analyze(skill)`). The Rendered/Source hero, Visualise and Export are analysis capabilities. |
| **Evaluation capability** | A *dynamic* capability on the seam — **runs the skill through a model** and observes behaviour. Costs tokens, needs a model (fails `model_unavailable` offline). Wraps an `Evaluator` (`evaluate(skill, gateway)`) that **owns its method, not its resources**: it builds its own conditions (Scenario / distractors / battery) but model access is handed in via the **model gateway**. Test run and Triggering eval are evaluation capabilities. |
| **Evaluation result** | The artifact an evaluation capability emits — the structured run-record. Ephemeral; **never shown raw**. Renders to **Insights** (and a detailed breakdown on demand). Distinct from the persisted **evaluation record** ([§6](#6-data-model-sketch)): the result is rendered now, the record is stored and re-rendered later. |
| **Insights** | The default, plain-language rendered surface of an evaluation result — meaning the user can act on, not a data wall. The audience bridge ([§1](#1-product-thesis)) lives in the *renderer*; a detailed breakdown sits behind it for depth (same Rendered/Source duality as the hero). |
| **Model gateway** | The platform's **single, controlled entry to the model** — its own module. Owns the Anthropic key + AI-SDK plumbing; exposes fine intent-level primitives `classify`/`runAgent` that callers compose into their own method. Pure mechanism — knows no evaluation kinds. Every call carries an **accounting tag** (`account` \| `platform`); the gateway routes accounting through the **usage** authority. Consumers: evaluation now; the portability transform, mock-data generation and the build loop later. |
| **Accounting tag** | Declared by the *caller* on every model-gateway call: **`account`** (user-attributable, subject to tier policy) or **`platform`** (the platform's own cost to enable a feature — e.g. generating mock data — never charged to a user's allowance). Three accounting streams: free+account = structural caps + provider cap-catch (no token counting, [§8](#8-free-tier)); paid+account = token-spend stream (deferred); platform = our own cost ledger (deferred). A model call denied by a cap fails `cap_reached` (distinct from `model_unavailable` = no model at all). |
| **Skill IR** | *One specific* artifact type on the seam: visualise's intermediate representation — nodes + edges, each carrying a **source-span** back into `SKILL.md`. A visualise concept, not the whole seam. |
| **Test run** | User-facing term for executing a skill against **mocked** tools to see how it behaves. The mechanism is the **mock-tool registry**; the agent tool is **`execute_skill`**. Nothing real is ever touched. (Always "test run" in user copy — never "sandbox": jargon that intimidates rather than informs.) |
| **Mock-tool registry** | The mechanism behind a test run: when the skill calls a tool (e.g. "fetch unread email"), the registry returns generated mock data instead. The skill runs end-to-end against fake tools, so the user sees its behaviour without anything real happening. No code execution or containers — skills are instruction-only, so there's nothing to containerise. |
| **Triggering eval** | The v1 validation: does the skill *fire* on the right prompts and *stay silent* on the wrong ones? Run competitively against a **distractor library** + a positive/negative **prompt battery**. |
| **Portability transform** | The one engine that strips Claude-specific scaffolding and re-expresses a skill's intent for another target. **Two surfaces:** *cross-provider validation* (does it survive ChatGPT/Gemini?) and *cross-primitive export* (Gem/GPT packages). Both deferred; built once. |
| **Rendered / Source view** | The hero's two views of the same skill. **Rendered** (default) = friendly sans-serif document. **Source** = raw `SKILL.md` monospace. Both are renderers on the seam. |

---

## 3. Core architecture — the through-line

A single **server-side agentic harness** (Vercel AI SDK + Claude) with a **tool registry**. Not N services — one agent loop, many tools.

```
Browser (React)  ──SSE──▶  Next.js route handler (owns API key)
       ▲                          │
       │ stream tool output       ▼
   preview / viz / chat     Build loop (Vercel AI SDK + Claude)
                                  │
                                  ▼
                            Tool registry:
                              write_skill, edit_skill,
                              visualise_skill, execute_skill,
                              + mock-tool registry integrations
```

- The **server owns the Anthropic API key**; it never touches the client.
- Tool-call output streams to the client over **SSE**.
- `execute_skill` runs against the **mock-tool registry** ([§2](#2-glossary--the-domain-language)): a test run, not real execution.

### 3.1 The skill-analysis seam (the spine)

Several capabilities are the **same shape**: *read the skill → emit a structured artifact → render it for a surface*. Build the seam once; each feature plugs in and gets richer by swapping the **renderer**, not the pipeline.

The seam carries **two capability shapes** — same `artifact → render` tail, different head:

- **Analysis** (static) — derives an artifact from the skill's **text alone**. Pure, runs offline. Wraps an `Analyzer` (`analyze(skill)`). Its artifact is *recomputed on demand*, never persisted. Rendered hero, Source view, Visualise, Export.
- **Evaluation** (dynamic) — produces an artifact by **running the skill through a model**. Needs a model (fails `model_unavailable` offline), costs tokens. Wraps an `Evaluator` (`evaluate(skill, gateway)`) that **owns its method, not its resources** — it builds its own conditions but is handed the **model gateway**, the platform's single metered entry to the model. It composes its method from the gateway's fine primitives (`classify`/`runAgent`); it never touches the raw model, the key, or token accounting. Its artifact (an **evaluation result**) is *persisted* as an evaluation record and renders to **Insights**. Test run, Triggering eval.

> The split is named so a new capability is classified **before** it's built: "is this analysis or evaluation?" decides whether it gets an `Analyzer` or an `Evaluator`, runs offline or needs the harness, recomputes or persists. The seam stays one spine; the two heads keep the model dependency and token cost out of the pure analysis surfaces.

| Capability | Shape | Extract / run | Render (v1) | Render (later) |
|---|---|---|---|---|
| **Rendered hero** | analysis | frontmatter + body | friendly structured document (sans-serif) | richer doc layout / inline editing |
| **Visualise** | analysis | skill IR (nodes+edges+source-spans) | Mermaid | interactive canvas (React Flow) |
| **Cross-primitive export** | analysis | instruction intent (via portability transform) | — (deferred) | Gem/GPT packages + import guides |
| **Test run** | evaluation | run skill vs. mock-tool registry → result | **Insights** (+ transcript on demand) | richer scenarios / multi-run |
| **Triggering eval** | evaluation | run skill vs. distractors + battery → result | **Insights** (+ pass/fail breakdown) | scored / workflow / regression |

This is what "build it flexible" means here: a **clean seam**, not a speculative v2 abstraction.

---

## 4. Decisions

Current choices and the reasoning behind them. Live — open to revision while we're still in flux.

| Branch | Decision | Why |
|---|---|---|
| Build loop | Claude on our key (Anthropic) via **Vercel AI SDK** | Skill primitive is Claude-tuned; we meter & bill; one harness, provider-swappable later |
| Skill scope | **Instruction-only** (`SKILL.md` + reference docs); no bundled runnable code | A test run becomes a mock-tool registry, not a container — removes all code-exec/isolation infra |
| Write / edit | `write_skill({content})` streams the whole doc on first draft; `edit_skill({old,new})` applies a highlighted diff on revisions | Mirrors Claude Code's Write+Edit; cheaper tokens; preview is a doc model supporting replace+patch |
| Visualise | Model emits a **skill IR** (nodes+edges, each with a **source-span** into `SKILL.md`); v1 thin **IR→Mermaid** renderer; diagram type model-chosen; 1 generation | IR is the stable contract; the later canvas reuses it; node↔source mapping paid once |
| Test run — mock data | Fixed schema per integration; **contents generated to stress the skill**; cached per session for deterministic re-runs | Relevant to the user's real case; billable token cost; deterministic within a session |
| Test run — tool selection | Mock tools **auto-inferred** from the skill; user can override | One-click test; manual add for undetected tools |
| Triggering eval | **Lightweight** — does the skill fire on the right prompts, stay silent on the wrong ones? Mirrors Anthropic's skill-builder output | Cheapest eval, no judge model, tests the #1 failure mode (bad description/triggers) |
| Triggering eval — competition | User skill + **distractor library** (~10 → ~30) + positive **and** negative **prompt battery** | Skill selection is competitive; testing in isolation gives false confidence |
| Cross-provider testing | **Honest portability check** via the portability transform — strip Claude scaffolding, inject `SKILL.md` body as a system prompt; *not* "skills run everywhere" | A skill is a Claude-specific primitive; honesty is the better pitch ("will my skill survive ChatGPT?") |
| Export v1 | Copy button + **`.zip`** of the proper Claude skill directory (`skillname/SKILL.md` + refs) | The `.zip` is the installable artifact; copy serves the paste-it case |
| Cross-primitive export | **Deferred** — opt-in, per-target zips (Gem/GPT) of transformed instructions + files + import guides; uses the **portability transform** | No target platform accepts programmatic skill import — the value is the transform + guide, not an installer |
| Authoring screen layout | **Preview-primary**: the streaming skill document is the hero; interaction is a **demoted control surface**, not a co-equal chat panel | The skill artifact is the product, not the conversation |
| Hero render mode | Hero has **two views: Rendered (default) + Source (toggle)** — see [§2](#2-glossary--the-domain-language). Default Rendered for newcomers; Source one click away | Bridge audience ([§1](#1-product-thesis)): raw monospace `SKILL.md` is the biggest "this is for programmers" signal. Rendered-default removes that wall without hiding the artifact. **Reuses the seam — Rendered is just another renderer**, so it's cheap |
| App shell | **Thin branded top bar** (chrome only, no nav links) + **left slideout menu** (all primary nav + account footer; collapsed icon rail by default, expands on demand) wrapping the hero + slim right interaction panel. Tool surfaces are **chips** on the hero header | Top bar stays clean framing; nav consolidated in the menu; hero gets max width by default |
| Stack | Next.js (App Router) + TS · Postgres (Prisma/Drizzle) · **Clerk** auth (Google+GitHub) · Vercel AI SDK · SSE · Vercel + Neon/Supabase | One language end-to-end; fastest empty-repo-to-deployed; the build loop lives in a route handler that already holds the key |
| Billing v1 | **Subscription tiers** (Free / Pro) via Clerk Billing; token meter built day one; PAYG/overage via Stripe Billing Meters later | Clerk PAYG not GA (mid-2026); the meter exists anyway for caps; reuse it for PAYG later, honour transparent margin then |
| Free-tier aggregate cost | **Provider-side spend/rate cap** (Anthropic Console); app **catches the limit-hit response** → flips free sessions to "out of free usage today, back in X" | Provider is source of truth; a catch (not a predictive counter) avoids double-accounting and fails safe |

---

## 5. v1 thin-slice spec (per capability)

The build loop is **not thin** — it's the core and must feel good. Everything else is the minimum that proves the shape.

1. **Auth + meter** — Clerk (Google+GitHub), Postgres, per-turn + per-token counter. Thin = no admin UI, enforced caps only.
2. **Build loop** — Vercel AI SDK + Claude; `write_skill`/`edit_skill`; SSE to preview. **Polished, not thin.**
3. **Visualise** — model emits skill IR; thin IR→Mermaid renderer; 1 generation; no diagram editing.
4. **Test run** — single run, 1 generated scenario, mock-tool registry with 1–2 mock integrations (email first), Claude only.
5. **Triggering eval** — small distractor library (~10), small prompt battery, "did it fire?" boolean. No judge model yet.
6. **Export** — copy + Claude `.zip`. Cross-primitive (Gem/GPT) deferred; button says "coming soon".
7. **Portability transform** — **stubbed** (engine designed, not built). One engine for both deferred surfaces.
8. **Billing** — Clerk subscription tiers (Free + one Pro), gating capabilities 4/5. Thin = no PAYG.

---

## 6. Data model (sketch)

- **`users`** — identity from Clerk (Google/GitHub).
- **`skills`** — `id, user_id, name, description, body, frontmatter_json, created_at`.
- **`skill_versions`** — append-only revisions of a skill (export is a pure function of a version; enables future regression evals).
- **`usage`** — per-user token + turn counters (drives caps now; drives PAYG metering later).
- **`eval_runs`** / **`test_runs`** — recorded triggering-eval and test-run results.

Export shapes (Claude `.zip` now; cross-primitive later) are **rendered from** the skill record — the schema is export-agnostic.

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
  | **Export** | export renderer | Claude `.zip` |

  **Two views via a header toggle:** *Rendered* (default, friendly sans-serif document) and *Source* (raw monospace `SKILL.md`). Streaming reads as *a document assembling itself* in Rendered, *code being typed* in Source. Default Rendered for the SMB first impression; Source for power users.
- **Right** — slim 300px interaction panel (typed drawer now; collapses to a floating voice-forward control when realtime voice lands — see [§9](#9-deferred-features--their-seams)).

**Why preview-primary:** the skill artifact is the product; the conversation merely nudges it. A fat chat transcript is the wrong frame — and actively wrong once voice is the input. The hero is the document; chat is a thin control surface beside it.

---

## 8. Free tier

- **OAuth-only** signup (Google + GitHub) — no passwords, no password-storage liability, raises per-account scripted-abuse cost.
- **One** skill-building session per account, naturally bounded by the **context window + a turn cap** → per-account spend is bounded by construction.
- Includes: 1 skill, 1 visualisation, 1 **test run** (+ its generated scenario). **No triggering evals. No import.**
- Export: copy + Claude `.zip` (cross-primitive export disabled / "coming soon").
- Aggregate protection: provider-side cap + the graceful-degradation catch (see [§4](#4-locked-decisions)).

---

## 9. Deferred features & their seams

Designed-for, not built. Each reuses an existing seam, so it's a renderer/config swap — not a new pipeline. The two principles worth stating explicitly:

- **The skill-analysis seam is the spine** — visualise, the Rendered hero, cross-primitive export, and triggering evals all plug into it. New capabilities should ask "what renderer is this?" before "what service is this?"
- **The portability transform is one engine, two surfaces** — cross-provider validation *and* cross-primitive export. Design and build it once.

**Deferred capabilities:**

- **Cross-provider validation** (portability check on GPT/Gemini/Grok) — Vercel AI SDK provider swap + the portability transform.
- **Cross-primitive export** (Gem/GPT packages + import guides) — same transform, different output surface.
- **Interactive visualise canvas** ("Claude design"-style point-and-annotate) — IR→React Flow renderer; **point-and-annotate falls out for free**: node → its source-span → inject that span as precise context into the next chat turn.
- **Richer evals** — workflow evals (run the full loop, LLM-as-judge against rubrics) → regression evals (pin a scenario set, track score across edits = the retention hook).
- **Insight agent** — today each evaluation produces its **Insight** (the plain-language interpretation rendered as Insights) from one bounded `generate` call. The richer future is a tool-using agent (`runAgent` + tools) that *investigates* a result — re-runs cases, inspects the skill — before explaining it. Cross-cutting: it would explain *any* evaluation kind, reusing the seam, and replaces the `generate` call without changing the `Insight` shape or the renderer.
- **Own-portfolio collision detection** — once accounts hold many skills, eval a new skill against the user's existing ones for trigger overlap.
- **PAYG / metered overage** — Stripe Billing Meters on the existing token meter; transparent margin. Pairs with **separate Anthropic keys/workspaces per tier** the moment paid users exist, so free-tier exhaustion can't block paying customers.
- **Realtime voice interaction** — the interaction surface evolves from the slim typed drawer (v1) to a floating **voice-forward control** (mic primary, typing fallback, no transcript column). Preview-primary was chosen so this is an *evolution, not a rework*; v1 UI choices must not block it. Slim drawer will stay as rendered transcript even in v2.

---
