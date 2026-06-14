# SkillSmith — Architecture

Single source of truth for **what we build and why** — product, system, services, data, **and** app/screen layout. All of it lives here because it's one *kind* of knowledge (decisions that translate into code), regardless of layer.

**Companion docs:**

- **`DESIGN.md`** — the *visual design system* (theme, color tokens, type scale, spacing, components).

---

## 1. Product thesis

**SkillSmith is a skill *testing / CI* tool that also authors.** That is the long-term thesis, and it's the sharp end of the pitch — most tools stop at editing; the durable value is *validating* a skill before it ships.

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
| **Build loop** | The core agentic loop: Claude writes/edits the `SKILL.md` through the `write_skill`/`edit_skill` tools, streaming to the preview. Reaches the model only through the **model gateway** (`streamAgent`), so a build turn is gated + accounted like every other model call. |
| **Skill-analysis seam** | The architectural spine. The shared pattern **read skill → emit a structured artifact → render it for a surface**. Built once; each feature is a new *renderer* on it, not a new pipeline. Carries **two capability shapes** (below). Distinct from the skill IR: the seam is the pattern, the IR is one artifact type on it. |
| **Analysis capability** | A *static* capability on the seam — derives a structured view from the skill's **text alone**. Pure, runs offline. Wraps an `Analyzer` (`analyze(skill)`). The Rendered/Source hero, Visualise and Export are analysis capabilities. |
| **Evaluation capability** | A *dynamic* capability on the seam — **runs the skill through a model** and observes behaviour. Costs tokens, needs a model (fails `model_unavailable` offline). Wraps an `Evaluator` (`evaluate(skill, gateway)`) that **owns its method, not its resources**: it builds its own conditions (Scenario / distractors / battery) but model access is handed in via the **model gateway**. Test run and Triggering eval are evaluation capabilities. |
| **Evaluation result** | The artifact an evaluation capability emits — the structured run-record. Ephemeral; **never shown raw**. Renders to **Insights** (and a detailed breakdown on demand). Distinct from the persisted **evaluation record** ([§6](#6-data-model-sketch)): the result is rendered now, the record is stored and re-rendered later. |
| **Insights** | The default, plain-language rendered surface of an evaluation result — meaning the user can act on, not a data wall. The audience bridge ([§1](#1-product-thesis)) lives in the *renderer*; a detailed breakdown sits behind it for depth (same Rendered/Source duality as the hero). |
| **Model gateway** | The platform's **single, controlled, metered entry to the model** — its own module. Owns the AI-SDK call plumbing; exposes fine intent-level primitives `classify`/`runAgent`/`streamAgent`/`generate` that callers compose into their own method. Pure mechanism — knows no capability kinds. It does **not** pick the provider/model or hold the key: it resolves a `LanguageModel` per call from the **model router**. Every call carries an **accounting tag** (`account` \| `platform`); the gateway routes accounting through the **usage** authority. Consumers: the build loop (via `streamAgent`) and evaluation. Cross-runtime validation and mock-data generation route through it next (future work). **Target state ([#34](https://github.com/CrowBe/SkillBuilder/issues/34), [#35](https://github.com/CrowBe/SkillBuilder/issues/35)):** as the one metered chokepoint, the gateway is also where input-size budgets, prompt caching (a frozen system prefix), and cache-aware token accounting are enforced and measured. |
| **Model router** | The platform's **single provider + model selection authority** — its own module, the layer beneath the gateway. Owns the **provider registry** (every provider the platform knows: Anthropic default, Nous Portal, extensible), their **credentials** (a server-pool key per provider, plus an optional **bring-your-own override** that wins when present), and the runtime-mutable **active selection** (which provider + model each primitive routes to). The gateway calls `resolve(primitive)` to get a `LanguageModel`; the **model console** drives the router's mutators so provider/model can be switched (or a key connected) at runtime, e.g. to rotate providers while testing the flow. Pure *selection* mechanism — knows no accounting or capability kinds. Per-capability routing (Opus for `streamAgent`, cheaper models for `classify`/`generate`) is expressed here as per-primitive model ids. Selection + bring-your-own keys are **process-local and single (not per-user)** in v1 — one shared active selection per instance, which suits the testing/rotation use case; per-user isolation + a persisted store is a future port + adapter swap. Keys never leave through its secret-free snapshot and are never logged. |
| **Accounting tag** | Declared by the *caller* on every model-gateway call: **`account`** (user-attributable, subject to tier policy) or **`platform`** (the platform's own cost to enable a feature — e.g. generating mock data — never charged to a user's allowance). Three accounting streams: free+account = structural caps + provider cap-catch (no token counting, [§8](#8-free-tier)); paid+account = token-spend stream (deferred); platform = our own cost ledger (deferred). A model call denied by a cap fails `cap_reached` (distinct from `model_unavailable` = no model at all). |
| **Skill IR** | *One specific* artifact type on the seam: visualise's intermediate representation — nodes + edges, each carrying a **source-span** back into `SKILL.md`. A visualise concept, not the whole seam. |
| **Test run** | User-facing term for executing a skill against **mocked** tools to see how it behaves. The mechanism is the **mock-tool registry**; the agent tool is **`execute_skill`**. Nothing real is ever touched. (Always "test run" in user copy — never "sandbox": jargon that intimidates rather than informs.) |
| **Mock-tool registry** | The mechanism behind a test run: when the skill calls a tool (e.g. "fetch unread email"), the registry returns generated mock data instead. The skill runs end-to-end against fake tools, so the user sees its behaviour without anything real happening. No code execution or containers — skills are instruction-only, so there's nothing to containerise. |
| **Triggering eval** | The v1 validation: does the skill *fire* on the right prompts and *stay silent* on the wrong ones? Run competitively against a **distractor library** + a positive/negative **prompt battery**. |
| **Cross-runtime validation** | The portability surface. Skills travel as-is under the open standard, so portability is a *behaviour* question, not a format one: one engine runs the skill's triggering battery against other runtimes' models (provider swap through the model gateway) and reports a per-runtime grid. Results are honest, model-level approximations of each tool's harness — copy says so. Deferred; target state ([#65](https://github.com/CrowBe/SkillBuilder/issues/65)). |
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
- Tool-call output streams to the client over **SSE**. **Target state ([#58](https://github.com/CrowBe/SkillBuilder/issues/58)):** evaluation runs stream the same way (per-case progress events, then the artifact) instead of blocking JSON responses.
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
| Provider/model routing | A standalone **model router** beneath the gateway owns the provider registry, credentials (server pool + bring-your-own override), and the runtime-mutable active selection; the **model console** switches it live | Splitting *selection/credentials* (router) from *metering* (gateway) keeps each pure; runtime switching lets us rotate providers/models to test the flow without redeploying, and bring-your-own keys layer on without breaking the server-owns-key default. Default selection still comes from env, so nothing changes for a plain boot |
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
2. **Build loop** — Claude via the model gateway's `streamAgent`; `write_skill`/`edit_skill`; SSE to preview. **Polished, not thin.**
3. **Visualise** — model emits skill IR; thin IR→Mermaid renderer; 1 generation; no diagram editing.
4. **Test run** — single run, 1 generated scenario, mock-tool registry with 1–2 mock integrations (email first), Claude only.
5. **Triggering eval** — small distractor library (~10), small prompt battery, "did it fire?" boolean. No judge model yet.
6. **Export** — copy + the standard skill folder `.zip`.
7. **Cross-runtime validation** — **stubbed** (engine designed, not built; [#65](https://github.com/CrowBe/SkillBuilder/issues/65)).
8. **Billing** — Clerk subscription tiers (Free + one Pro), gating capabilities 4/5. Thin = no PAYG.

---

## 6. Data model (sketch)

- **`users`** — identity from Clerk (Google/GitHub).
- **`skills`** — `id, user_id, name, description, body, frontmatter_json, created_at`.
- **`skill_versions`** — append-only revisions of a skill (export is a pure function of a version; enables future regression evals). **Target state ([#72](https://github.com/CrowBe/SkillBuilder/issues/72)):** versioning is a product concept — restore-a-version lands as a *new* head revision (append-only stays append-only), with a default 10-version retention cap that never breaks stored run records.
- **`usage`** — per-user token + turn counters (drives caps now; drives PAYG metering later).
- **`eval_runs`** / **`test_runs`** — recorded triggering-eval and test-run results. **Target state ([#57](https://github.com/CrowBe/SkillBuilder/issues/57)):** each run carries a `skill_version_id` pinning the result to the revision it evaluated — the substrate for regression evals. **Read path ([#61](https://github.com/CrowBe/SkillBuilder/issues/61)):** list/fetch APIs + My skills / History surfaces re-render stored records through the seam renderers.

**Persistence invariants.** All DB access goes through Prisma's query builder — **no raw SQL anywhere**, so stored skill content can never become a SQL payload (parameterized-only). ESLint bans raw SQL calls unless a reviewed exception is added. Row ownership is enforced *in the query* (`where: { id, userId }`) for user-owned records rather than only re-checked in callers. **Target state ([#34](https://github.com/CrowBe/SkillBuilder/issues/34)):** `frontmatter_json` bounded (size / depth / key-count) with unsafe keys (`__proto__`, `constructor`) rejected on parse. Skill content and prompts are never written to logs.

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
- Includes: 1 skill (**built or imported** — import is free by construction: paste / GitHub URL costs no model tokens, and it's the acquisition wedge, [#66](https://github.com/CrowBe/SkillBuilder/issues/66)), the **lint report** (pure analysis, zero tokens, uncapped), 1 visualisation, 1 **test run** (+ its generated scenario). **No triggering evals.**
- Structural bounds extend to import's non-model costs: a per-account **skill-count cap** (the "1 skill" above, one tunable constant) and a per-user **rate limit on import fetches** ([#73](https://github.com/CrowBe/SkillBuilder/issues/73)).
- Export: copy + the standard skill folder `.zip`.
- Aggregate protection: provider-side cap + the graceful-degradation catch (see [§4](#4-locked-decisions)).

---

## 9. Deferred features & their seams

Designed-for, not built. Each reuses an existing seam, so it's a renderer/config swap — not a new pipeline. The two principles worth stating explicitly:

- **The skill-analysis seam is the spine** — visualise, the Rendered hero, export, and triggering evals all plug into it. New capabilities should ask "what renderer is this?" before "what service is this?"
- **Cross-runtime validation is an evaluation capability on the seam** — a provider swap inside one engine, not a parallel pipeline.

**Deferred capabilities:**

- **Skill import** (paste `SKILL.md` text / GitHub URL) — the acquisition wedge: same parse → persist → render path as the build loop, no authoring required ([#66](https://github.com/CrowBe/SkillBuilder/issues/66)).
- **Skill lint** — a static quality report (spec compliance, structure, description/trigger heuristics): a pure analysis capability on the seam, zero tokens, auto-run on every version ([#69](https://github.com/CrowBe/SkillBuilder/issues/69)–[#71](https://github.com/CrowBe/SkillBuilder/issues/71)).
- **Cross-runtime validation** (does the skill trigger/behave on Codex/Gemini-class models?) — the existing triggering battery run via provider swap through the model gateway; per-runtime results grid ([#65](https://github.com/CrowBe/SkillBuilder/issues/65)).
- **Interactive visualise canvas** ("Claude design"-style point-and-annotate) — IR→React Flow renderer; **point-and-annotate falls out for free**: node → its source-span → inject that span as precise context into the next chat turn.
- **Richer evals** — workflow evals (run the full loop, LLM-as-judge against rubrics) → regression evals (pin a scenario set, track score across edits = the retention hook).
- **Insight agent** — today each evaluation produces its **Insight** (the plain-language interpretation rendered as Insights) from one bounded `generate` call. The richer future is a tool-using agent (`runAgent` + tools) that *investigates* a result — re-runs cases, inspects the skill — before explaining it. Cross-cutting: it would explain *any* evaluation kind, reusing the seam, and replaces the `generate` call without changing the `Insight` shape or the renderer.
- **Skill tap** (publish + Skill library) — a public installation source other tools add once and install from. Moderation must precede distribution — full design in [§9.1](#91-skill-tap--moderation-before-distribution).
- **Own-portfolio collision detection** — once accounts hold many skills, eval a new skill against the user's existing ones for trigger overlap.
- **PAYG / metered overage** — Stripe Billing Meters on the existing token meter; transparent margin. Pairs with **separate Anthropic keys/workspaces per tier** the moment paid users exist, so free-tier exhaustion can't block paying customers.
- **Realtime voice interaction** — the interaction surface evolves from the slim typed drawer (v1) to a floating **voice-forward control** (mic primary, typing fallback, no transcript column). Preview-primary was chosen so this is an *evolution, not a rework*; v1 UI choices must not block it. Slim drawer will stay as rendered transcript even in v2.

### 9.1 Skill tap — moderation before distribution

Designed, not built. **This design gates the tap: no tap code lands until the moderation system exists** — shipping a distribution source without it is a reputational one-way door. "Tap" (an installation source you add once, then install from by name) is the internal term; user-facing copy says **Publish** / **Skill library**. A tap is *distribution*, not deploy: a validated skill gets a public address, nothing runs.

**Threat model.** Skills carry no code, but that bounds *our* platform, not the consumer's runtime — a published `SKILL.md` installs into agents holding shells, browsers, and credentials. Model a skill as **a program whose interpreter is an LLM**. Classes: (1) **direct malicious instructions** (the skill is the payload, the host agent the executor); (2) **agent hijacking** — overriding the host's guardrails; (3) **trigger hijacking** — a deceptive `description` fires the skill where it has no business, the tap-specific risk since the standard selects on descriptions; (4) **latent payloads** — benign on read, malicious on a date/keyword/fetched URL; (5) **reference-file smuggling** — every gate layer reads the whole folder, not just `SKILL.md`; (6) **typosquatting / impersonation**. Hard limit, accepted: class 4 isn't solvable by review — anything checked once is defeated by indirection. The countermeasure is *content policy*: instructing the agent to fetch-and-follow remote instructions is a hard lint failure. We narrow what a published skill may do in exchange for being able to reason about it.

**The gate is the seam** — SkillSmith is a validation tool that also distributes, not a file host bolting moderation on. Publication reuses the seam: **skill lint** carries the static policy rules (shell-exec patterns, credential paths, fetch-and-follow indirection, obfuscation); the **triggering eval**'s negative battery gains adversarial prompts, making it the trigger-hijack scanner; the **test run** catches behaviour the text hides (exfiltration-shaped tool calls show in the transcript); and a new **`safetyReviewCapability`** — an LLM-judge evaluation capability, `platform`-tagged — reads the full folder and scores injection/exfiltration/deception. The judge is **structurally untrusted**: it reads the skill strictly as data, and its verdict is a backstop, never the sole gate.

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

---
