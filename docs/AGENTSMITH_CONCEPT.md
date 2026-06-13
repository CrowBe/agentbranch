# AgentSmith — concept

> **Status: forward concept, not current state.** Every other doc in this repo reads
> as *what is true today* (CLAUDE.md: "Docs read as current state — no history"). This
> one is the exception by design: it describes a proposed expansion — **SkillSmith → AgentSmith,
> a skill factory becoming an agent factory** — that is *not yet built*. It exists as a
> separate file precisely because its content fits nowhere in the current-state docs without
> poisoning them with speculation. Nothing here is committed until it graduates: when a
> section becomes real, it moves into `ARCHITECTURE.md` / `DESIGN.md` / `MODULE_DESIGN.md`
> and is deleted from here. Treat this as the thing to react to, not the thing to build from.

---

## 1. The thesis shift

SkillSmith builds and validates **skills** — instruction-only artifacts, one to a session.
The skill is the unit of work, and that scoping bought a lot: no runtime, no containers,
"nothing to containerise" (`ARCHITECTURE.md §4`).

**AgentSmith makes the *agent* the unit of work.** A skill is no longer the product — it's
one *component* an agent acquires. The product becomes a **factory** that composes an agent
from skills, subagents, tools, and config, then lets the user **download, install, or deploy**
it. SkillSmith's entire existing machine — the build loop, the seam, the evals — becomes
**one builder among several** (the *skill builder*), feeding a larger composition.

The pitch sharpens, not blurs: *most tools stop at editing a prompt; AgentSmith builds you
an agent you can actually run, and proves it works before you ship it.* The validation thesis
(`ARCHITECTURE.md §1`) carries straight over — we're now validating an agent's behaviour, not
just a skill's triggering.

**This reverses a domain-language decision** and that has to be deliberate (see §2).

---

## 2. Domain expansion — and the term we're un-banning

CONTEXT.md currently lists **"agent"** as a *banned alias* for Skill (`_Avoid_: prompt, agent,
bot, automation`). AgentSmith promotes **Agent** to a first-class, top-level term. That is a
genuine reversal of a ubiquitous-language decision, so per CLAUDE.md it earns a decision-register
note rather than a silent edit:

> **Decision (reversal): "Agent" becomes a first-class domain term.** Previously banned as a
> fuzzy alias for Skill, because the product had exactly one unit and "agent" blurred it. With
> the agent factory, Agent and Skill are *distinct units at different altitudes* — an Agent is
> composed *of* Skills — so the term now has a precise, non-overlapping meaning. Keeping it
> banned would force awkward circumlocutions for the new top-level concept.

New core terms (these graduate into CONTEXT.md / `ARCHITECTURE.md §2` when built):

| Term | Definition | Avoid |
|---|---|---|
| **Agent** | The new top-level unit of work: a composition of acquired **skills**, **subagents**, tool grants, and config — packaged into a runnable artifact the user can download, install, or deploy. The thing the factory produces. | bot, assistant, automation |
| **Orchestrator** | The *original* agent at the centre of a build — the one that stays, coordinates, and **spawns** subagents to do work. Every Agent is an Orchestrator plus what it spawns. (Agent Smith stays himself; the copies are extra.) | parent, root, supervisor |
| **Subagent** | A spawned worker the Orchestrator delegates to — its own skills + tools + a narrow remit. Built by the **subagent builder**, instantiated (spawned) by the Orchestrator at run time. | child, clone, worker (in copy) |
| **Builder** | A capability that *authors a component* of an agent through a chat-driven loop. The **skill builder** (today's whole build loop) is the first; the **subagent builder** is next; more follow (tool/MCP builder, config builder). Builders are the generalization of the current build loop. | wizard, generator, editor |
| **Acquired skill** | A skill an Agent carries — "acquired in combat" (§4): authored *and validated* through the loop, then attached to the agent's loadout. | attached skill, installed skill |
| **Deployment target** | Where a finished agent goes: **download** (the artifact folder/archive), **install** (into a host runtime the user controls), or **deploy** (a managed container we run). | export target (export is one target) |

Crucially, **the skill keeps its exact current definition.** AgentSmith *adds an altitude
above* skills; it does not redefine them. The seam, `SKILL.md`, the evals — all unchanged in
meaning. That's what makes this an expansion and not a rewrite.

---

## 3. The Matrix metaphor map

The film isn't decoration — it's a *teaching layer*. Each metaphor explains a real mechanic to
a user who'd otherwise need the architecture doc. The discipline: **every metaphor must map to
something true**, or it's costume, not pedagogy.

| The Matrix | AgentSmith concept | What it teaches |
|---|---|---|
| Red pill / Blue pill | The entry choice — full Matrix experience vs. warm "soft reality" (§5) | Your first decision is *how you want to see the tool*; both are real, neither is locked. |
| Agent Smith spawning copies | The **Orchestrator spawning subagents** | One agent becomes many on demand; the original stays and coordinates. |
| "Acquiring skills in combat" / loading a program ("I know kung fu") | The **build + eval loop** hardening a skill before it's acquired | A skill isn't *had* until it's been tested — combat (distractor battery, adversarial prompts, test runs) is where it's earned. |
| The Construct (the white loading room) | The **test-run / eval environment** — mock tools, nothing real touched | You can load and try anything safely before it's deployed; it's a loadout room, not the real world. |
| "Guns. Lots of guns." (the loadout racks) | **Assembling the agent's loadout** — skills + subagents + tools | Building an agent is choosing a loadout; the factory is the armoury. |
| The Operator (Tank, feeding programs in) | The **builders** + model gateway feeding capabilities into the agent | There's a controlled channel through which capability enters an agent — it doesn't appear from nowhere (the gateway is still the one metered chokepoint). |
| Residual self-image | The **Rendered view** of an agent — how it presents vs. its raw source | What you see is a friendly projection; the source is one toggle away (the existing Rendered/Source duality, lifted to agents). |
| Digital rain (streaming green code) | The **loading / streaming** state — and the red-pill brand signature (§5) | The system is *doing something*; streaming is the product's resting motion, now literalised. |

The metaphors are **copy and motion**, not new mechanics. They name things the architecture
already does (gateway, seam, test run) so the fantasy and the system point at the same object.

---

## 4. Branding — red pill / blue pill

The brand tension is real: the current identity is **warm-pro, light-default, built as a bridge
to the non-technical SMB owner**, and `DESIGN.md §1` explicitly warns that "austere
mono-everything dark chrome" *alienates* that audience. Matrix branding *is* that failure mode.
We don't resolve this by compromising the visuals to a muddy middle — we resolve it by **making
it the user's first choice.**

**On entry, before auth: red pill or blue pill.**

| Choice | Experience | Audience it serves |
|---|---|---|
| **Red pill** | Full Matrix: near-black canvas, phosphor-green primary, mono-forward type, **digital-rain** streaming loaders, glitch/spawn motion. "Show me how deep the rabbit hole goes." | The power user / builder who wants the fantasy and the dev-coded credibility. |
| **Blue pill** | The current **warm-pro** system, untouched: light default, Inter/Hanken, cobalt/teal/amber, generous whitespace, "soft reality." | The SMB owner; anyone who'd bounce off green-on-black. The bridge survives intact. |

**Why this fits the architecture cleanly.** DESIGN.md already ships *two themes with identical
semantic role names where "only hex differs"* (`§4`). Red/blue pill is the **same mechanism,
one variant deeper**: a theme + a small set of component variants (loaders, motion), resolved
from the same role tokens, **chosen once and cached as a preference** — exactly the "pure
theming/component swap, cached" shape. It is *not* two codebases; it's one component tree
reading one more token axis.

Design rules so red pill stays *pedagogical*, not *hostile*:

- **Role tokens are shared.** Primary/secondary/tertiary/error keep their *meanings* (`DESIGN.md §4`);
  red pill only re-hexes them (green primary, amber→toxic-amber warnings, etc.). No semantic fork.
- **Legibility is non-negotiable.** Digital rain is *loading/decoration*, never *content*. Body
  copy stays plain-language sentence case in both pills (the warm-pro copy discipline is brand-agnostic).
- **The pill is reversible and sticky.** Switchable anytime from settings; remembered per account.
  First impression ≠ life sentence.
- **Blue pill is the safe default** for anyone arriving without choosing (deep link, returning SMB),
  preserving the welcoming-first-impression rule.

DESIGN.md §6 ("not yet designed") gains: red-pill token table, digital-rain loader spec, the
pill-selection entry screen, and spawn/glitch motion primitives.

---

## 5. Architecture — it's the same seam, one altitude up

The reason this is *expansion* and not *rewrite*: the existing spine generalizes almost as-is.

- **Builders = the build loop, pluralised.** Today `build-loop` is one module driving one chat
  loop that writes a `SKILL.md` through `write_skill`/`edit_skill` via the gateway's `streamAgent`.
  The **subagent builder** is the *same shape* — a chat loop writing a subagent's definition through
  its own write/edit tools, same gateway, same SSE streaming. A builder is "the build loop, parameterised
  by what artifact it authors." No new pipeline (MODULE_DESIGN §6, rule 1).
- **An Agent is both analyzable and evaluable on the seam.** The skill-analysis seam (read →
  artifact → render) becomes the **artifact-analysis seam** where the artifact may be a skill *or
  an agent*:
  - *Analysis (static):* a **Rendered/Source view of the agent** (its composition as a friendly doc
    vs. its raw definition), a **Visualise** of the Orchestrator→subagent spawn graph (the existing
    IR+Mermaid renderer, new artifact kind), and **export** of the agent folder.
  - *Evaluation (dynamic):* a **test run of the whole agent** against mock tools (Construct), and
    behavioural evals of the agent's orchestration — both reusing `Evaluator` + the model gateway
    exactly as today, just over a bigger artifact.
- **The model gateway does not change.** It stays the single metered chokepoint; builders and
  agent-evals are new *consumers*, declaring accounting tags like everyone else. The accounting model
  (`account` vs `platform`) already covers "the user is building" vs "the platform is stress-testing."

New `ArtifactKind` members (`"agent" | "subagent" | "spawn-graph" | ...`) and new `Builder`/`Agent`
domain modules; **no new architectural primitive.** That's the test of whether this concept is sound:
if agent-building needed a *new spine*, the seam was wrong. It doesn't.

---

## 6. The real departure — runnable agents

One thing genuinely breaks the current model, and it must be named honestly. SkillSmith is
instruction-only on purpose: a skill carries no runnable code, so a "test run" is a mock-tool
registry and there is **nothing to containerise** (`ARCHITECTURE.md §4`). That cleanliness ends at
**deploy.** An *agent you can run* reintroduces a real runtime:

| Target | What it is | New surface area |
|---|---|---|
| **Download** | The agent as a folder/archive (skills + subagent defs + manifest). Pure artifact — the natural extension of today's export. | Lowest risk; reuses the export renderer. |
| **Install** | The same artifact, placed into a **host runtime the user controls** (their Claude Code, their machine). We hand over a package; they run it. | Packaging + an install manifest; *we* still run nothing. |
| **Deploy** | A **managed container we run** that hosts the agent. | The big one: real execution, isolation, secrets, billing-by-runtime, the whole moderation/safety surface that `ARCHITECTURE.md §9.1` deferred — *amplified*, because now code actually runs. |

**Deploy is a one-way door** and should be the *last* phase, gated behind the safety work the Skill
Tap design (`§9.1`) already sketched — but harder, because a deployed agent acts, not just advises.
Download and install are reachable far sooner and deliver most of the "I can take my agent with me"
value without standing up runtime infra. **Recommend: earn the agent-factory story on download/install
first; treat managed deploy as a separate, safety-gated program.**

---

## 7. Roadmap (concept-level)

Ordered so each phase ships value and de-risks the next. Nothing here is a commitment — it's the
shape of the bet.

1. **Red/blue pill + rebrand.** Pure presentation: the pill entry screen, the red-pill theme variant
   + digital-rain loader, the AgentSmith name. Reuses the existing two-theme machinery. *Lowest risk,
   highest visible signal — proves the brand direction before any domain work.*
2. **Agent as a first-class artifact (analysis only).** The `Agent` module + composition model;
   Rendered/Source agent view + spawn-graph Visualise + agent export, all on the seam. No new
   runtime. *Proves the seam generalizes.*
3. **Subagent builder.** The second builder, sibling to the skill builder; the Orchestrator→subagent
   spawn model becomes real. *Proves "builders pluralise."*
4. **Agent evals.** Test-run + behavioural eval of the whole agent (Construct over the composition).
   *Lifts the validation thesis to agents.*
5. **Download / install packaging.** The agent artifact + install manifest. *The "take it with you" payoff.*
6. **Managed deploy (separate, safety-gated program).** Runtime, isolation, the amplified §9.1 safety
   surface. *Only when the rest is proven and the safety work is done.*

---

## 8. Open questions

- **One product or two?** Is AgentSmith a *rename* of SkillSmith, or a superset where "SkillSmith"
  survives as the skill-builder surface inside it? (Affects naming, marketing, the repo.)
- **Does an agent compose existing skills, or only freshly-built ones?** I.e. is there an "acquire
  from my skill library" path (pairs naturally with the deferred Skill Tap, §9.1)?
- **How literal is "spawning"?** Is a subagent a real sub-loop the Orchestrator invokes at run time,
  or a build-time composition the host runtime decides to parallelise? (Changes what "deploy" must run.)
- **Red-pill scope.** Theme + loaders only, or does motion (glitch/spawn) reach into core interactions?
  More reach = more to design and test in *both* pills.
- **Does managed deploy change the billing model** from per-token to per-runtime, and does that pull
  the deferred PAYG work forward?
