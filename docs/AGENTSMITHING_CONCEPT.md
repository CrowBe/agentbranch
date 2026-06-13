# AgentSmithing — concept

> **Status: forward concept, not current state.** Every other doc in this repo reads
> as *what is true today* (CLAUDE.md: "Docs read as current state — no history"). This
> one is the exception by design: it describes a proposed expansion — **SkillSmith → AgentSmithing,
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

**AgentSmithing makes the *agent* the unit of work.** A skill is no longer the product — it's
one *component* an agent acquires. The product becomes a **forge** that shapes an agent from
skills, subagents, tools, connectors and config, then lets the user **download, install, or
deploy** it. SkillSmith's entire existing machine — the build loop, the seam, the evals —
becomes **one builder among several** (the *skill builder*), feeding a larger composition.

The pitch sharpens, not blurs: *most tools stop at editing a prompt; AgentSmithing forges you
an agent you can actually run, and tempers it — proves it holds — before you ship it.* The
validation thesis (`ARCHITECTURE.md §1`) carries straight over: we're now validating an agent's
behaviour, not just a skill's triggering.

**This reverses a domain-language decision** and that has to be deliberate (see §2).

---

## 2. Domain expansion — and the term we're un-banning

CONTEXT.md currently lists **"agent"** as a *banned alias* for Skill (`_Avoid_: prompt, agent,
bot, automation`). AgentSmithing promotes **Agent** to a first-class, top-level term. That is a
genuine reversal of a ubiquitous-language decision, so per CLAUDE.md it earns a decision-register
note rather than a silent edit:

> **Decision (reversal): "Agent" becomes a first-class domain term.** Previously banned as a
> fuzzy alias for Skill, because the product had exactly one unit and "agent" blurred it. With
> the agent factory, Agent and Skill are *distinct units at different altitudes* — an Agent is
> composed *of* Skills — so the term now has a precise, non-overlapping meaning. Keeping it
> banned would force awkward circumlocutions for the new top-level concept.

New core terms (these graduate into CONTEXT.md / `ARCHITECTURE.md §2` when built). Each carries a
forge metaphor for *copy/teaching*, but the **left column is the canonical term** — the metaphor
never replaces it (see §4.2):

| Term | Definition | Forge metaphor | Avoid |
|---|---|---|---|
| **Agent** | The new top-level unit of work: a composition of acquired **skills**, **subagents**, **tools**, **connectors** and config, packaged into a runnable artifact you download, install, or deploy. | the finished, tempered piece | bot, assistant, automation |
| **Orchestrator** | The *original* agent at the centre of a build — it stays, coordinates, and directs **subagents**. Every Agent is an Orchestrator plus what it directs. | the master smith | parent, root, supervisor |
| **Subagent** | A worker the Orchestrator delegates to — its own skills + tools + a narrow remit. Built by the **subagent builder**, run as a coordinator-roster member. | an apprentice at the bench | child, clone, worker |
| **Builder** | A capability that *authors one component* of an agent through a chat-driven loop — the generalization of today's build loop. Skill / subagent / tool / connector / orchestrator / guardrail builders (§5). | a station in the workshop | wizard, generator, editor |
| **Tool** | An executable grant the agent can call (name + description + input schema) — its hands. | a tool on the rack | function, action |
| **Connector** | A wiring to an external service the agent reaches (an MCP server) plus its credential. How an agent touches real systems. | the bellows / supply line | integration, plugin, API |
| **Guardrail** | A policy on what the agent may do automatically vs. must ask first — its safety posture. | the safety on the press | rule (skill-internal), permission |
| **The Forge** | The assembly surface where authored components become one Agent (the composition view). A builder authors a *part*; the Forge joins them. | the forge itself | studio, canvas |
| **Acquired skill** | A skill an Agent carries: authored *and tempered* through the loop, then set into the agent's loadout. | a blade fitted to the haft | attached / installed skill |
| **Deployment target** | Where a finished agent goes: **download** (archive), **install** (a host runtime the user controls), **deploy** (a managed container we run). §6. | where the piece ships | export target (export is one target) |

Crucially, **the skill keeps its exact current definition.** AgentSmithing *adds an altitude
above* skills; it does not redefine them. The seam, `SKILL.md`, the evals — all unchanged in
meaning. That's what makes this an expansion and not a rewrite.

---

## 3. The forge metaphor map

The forge isn't decoration — it's a *teaching layer*, and it earns its keep two ways: it's
universally legible (everyone understands hammering hot metal) and **every metaphor maps to
something true**, or it's costume, not pedagogy. It also maps cleanly onto *real Claude-platform
primitives*, which is what keeps the agent-factory claim credible (§5).

| The forge | AgentSmithing concept | What it teaches / maps to |
|---|---|---|
| Raw stock → ingot → finished piece | Rough intent → `SKILL.md` / agent definition taking shape | You start from rough material and *shape* it; the artifact is worked, not conjured. |
| The fire (heat) — sparks of binary | The model gateway doing work; "hot" = streaming/active. Binary embers are the streaming motion. | There's one heat source: the gateway is the single metered chokepoint everything passes through. |
| Hammer & anvil — striking | The build loop (`write_skill` / `edit_skill`); each strike is an iteration. | An agent is shaped by repeated strikes, not poured in one go. |
| **Tempering** | The eval loop — test run + triggering eval — hardening a skill/agent by stressing it. | You don't trust the blade until it's tempered: validation *is* the product (`ARCHITECTURE.md §1`). |
| Master smith + apprentices | Orchestrator + subagents (the coordinator roster) | One smith directs many apprentices; the master stays at the anvil and coordinates. |
| The tool rack on the wall | The agent's loadout — skills + tools + connectors | Building an agent is choosing what hangs on the wall. |
| The maker's **hallmark** | Publish + provenance — content hash + attribution (Skill Tap, `ARCHITECTURE.md §9.1`) | A stamped piece is traceable to its smith; the hallmark is what makes distribution trustworthy. |
| Quench & finish | Package + ship — download / install / deploy (§6) | The last step sets the work hard and sends it out. |

The metaphors are **copy, iconography and motion**, not new mechanics — they name things the
architecture already does (gateway, seam, test run) so the fantasy and the system point at the
same object. Where they'd *rename* an established term, they stop (§4.2).

---

## 4. Identity — the forge

The brand tension is real: the current identity is **warm-pro, light-default, built as a bridge
to the non-technical SMB owner**, and `DESIGN.md §1` warns that "austere mono-everything dark
chrome" *alienates* that audience. We resolve it the way DESIGN.md already resolves light/dark —
**two faces of one forge**, sharing semantic role tokens, differing only in treatment:

| Mode | Treatment | Audience it serves |
|---|---|---|
| **Workshop** (light, **default**) | Daylight workshop / blueprint: the current warm-pro system intact — Inter/Hanken, cobalt/teal/amber, generous whitespace, clean paper. | The SMB owner; anyone who'd bounce off dark chrome. The bridge survives untouched. |
| **Forge** (dark) | The forge lit: charcoal/iron canvas, **forge-glow amber** primary, hot-metal accents, **binary sparks/embers** in motion, hammer-strike micro-interactions. | The maker / power user who wants the heat and the craft fantasy. |

This **drops the Matrix borrow entirely** (no red/blue pill, no digital rain — see §4.3) for an
identity that's IP-clean *and* reinforces the name: AgentSmith**ing** is a craft, and the visuals
are the craft. The forge is theme, not theatre — **Workshop is the default**, the maker gets the
fire on a toggle, and the bridge to the SMB owner is preserved by construction.

> **Palette note for DESIGN.md:** Forge mode pushes the *primary* toward forge-amber, which
> currently means "warning/constraint" (`DESIGN.md §4`). Forge mode needs a distinct warning
> signal (a hotter red, or an ember-pulse) so the heat aesthetic doesn't swallow the amber
> semantics. Flagged, not solved — it lands in DESIGN.md when Forge mode is designed.

### 4.1 The wordmark — `AgentSmithing|<Builder>`

The product *is* **AgentSmithing** (the rename: "SkillSmith" does not survive). The wordmark's
second segment is **dynamic**, naming the **active builder** (§5), so the mark doubles as a
"where am I":

| Surface | Wordmark |
|---|---|
| The skill builder (today's whole product) | `AgentSmithing\|Skills` |
| The subagent builder | `AgentSmithing\|Subagents` |
| The tool / connector / orchestrator / guardrail builders | `AgentSmithing\|<its domain>` |

The constant **AgentSmithing** is the craft / the master smith; the suffix is *what you're forging
right now*. The Smith pun carries it — one smith, many wares. Themed per mode: struck-metal
nameplate in Forge, clean wordmark in Workshop. (When no builder is active — landing, account —
the mark is just `AgentSmithing`.)

### 4.2 Forge naming — the discipline (where the theme stops)

The risk you flagged is real: forge jargon a user can't decode is *worse* than plain words. So
the theme has a hard boundary.

**Forge naming governs** — the brand, iconography, motion, and **names for genuinely-new
agent-factory concepts that have no domain term yet** (the **Forge**, the **hallmark**,
"apprentice" as warm copy for a subagent in onboarding).

**Forge naming never touches the domain glossary.** `Skill`, `test run`, `triggering eval`,
`build loop`, `Insights` stay exactly as they are (CLAUDE.md: domain language is non-negotiable —
"always *test run*, never *sandbox*"). The forge *dresses* them — an anvil icon on the **Test run**
chip, a spark loader while it runs — but the **label stays the plain word**. Renaming "test run"
→ "quench" both breaks the contract and adds the abstraction we're avoiding.

**The stage names** (the journey framing) take a light forge flavour *with a plain subtitle*, so
the metaphor aids rather than gates:

| Stage | Plain subtitle (always shown) | What happens | Abstraction risk |
|---|---|---|---|
| **Blueprint** | *Design your agent* | Pick the orchestrator's job + persona | Low — "blueprint" is universal |
| **Forge** | *Build the parts* | Skill / subagent / tool / connector builders | Low |
| **Temper** | *Test it holds* | Test run + triggering eval over the agent | **Watch** — keep the subtitle; "temper" is flavour, the functional verb is "test" |
| **Finish** | *Package & ship* | Download / install / deploy | Low |

Rule of thumb: **a forge term earns its place only if it names something with no existing domain
term *and* is self-evident to an SMB owner.** When in doubt, the plain word wins and the forge
stays in the icon and the motion.

### 4.3 IP footing (now low)

The Matrix pivot resolves most of the earlier exposure. The two biggest borrows are gone: the
**digital-rain visual** (replaced by the forge) and any **character-name reconstruction** (the
forge theme leans `-smith` as a *craft*, the way "SkillSmith" already does — one who smiths skills
→ one who smiths agents). What's left is a craft-trade name on a forge aesthetic — ordinary and
defensible. It's also *distinctive*, which matters as much as defensible: the obvious alternative,
**AgentForge**, is saturated in this exact niche — many shipping "AgentForge"/"Agent Forge"
agent-builders (one with the same SMB positioning, plus Microsoft's `agent-forge` for agent-config
generation) and a phonetic hair from Salesforce's heavily-enforced **Agentforce**. So "forge" earns
its place as the *theme and the in-product surface* (`the Forge`, §2), **not the brand** — the smith
works the forge. Still prudent, not paranoid: **a trademark clearance search on "AgentSmithing"
before the name and launch branding lock** (not legal advice; it's a real commercial product). Keep
any Matrix *references* to the occasional in-product wink, never the brand.

---

## 5. Architecture — same seam, broadened builders

The reason this is *expansion* and not *rewrite*: the existing spine generalizes almost as-is.

- **Builders = the build loop, pluralised.** Today `build-loop` drives one chat loop that writes a
  `SKILL.md` via `write_skill`/`edit_skill` through the gateway's `streamAgent`. Every new builder
  is the *same shape* — a chat loop writing one component's definition through its own write/edit
  tools, same gateway, same SSE streaming. "The build loop parameterised by what it forges." No new
  pipeline (MODULE_DESIGN §6, rule 1). Each builder is a wordmark segment (§4.1).

  | Builder | Forges | Maps to (real runtime, §6) | Phase |
  |---|---|---|---|
  | **Skill** | a `SKILL.md` | Agent Skills standard | today |
  | **Subagent** | an apprentice (roster member) | Claude Code subagent md / Managed-Agents roster | near |
  | **Tool** | a custom tool (name + desc + input schema) | custom tool definition | near |
  | **Connector** | an MCP wiring + credential | MCP server + vault credential | near |
  | **Orchestrator** | the master smith's persona — system prompt + model + how it directs apprentices | agent system/model/`multiagent` | mid |
  | **Guardrail** | what the agent may do vs. must ask | permission policies | mid |
  | *(later)* **Memory / Schedule / Environment** | persistence, cadence, deploy config | memory stores / scheduled deployments / environment | later |

- **An Agent is both analyzable and evaluable on the seam.** The skill-analysis seam (read →
  artifact → render) becomes the **artifact-analysis seam** where the artifact may be a skill *or
  an agent*:
  - *Analysis (static):* a **Rendered/Source view of the agent**, a **Visualise** of the
    Orchestrator→subagent graph (the existing IR+Mermaid renderer, new artifact kind), and **export**.
  - *Evaluation (dynamic):* a **test run of the whole agent** against mock tools, and behavioural
    evals of its orchestration — both reusing `Evaluator` + the model gateway, just over a bigger
    artifact.
- **The model gateway does not change.** It stays the single metered chokepoint (the one fire);
  builders and agent-evals are new *consumers*, declaring accounting tags like everyone else.
- **The output is a *composed agent*, and the substrate is still markdown + config.** This is the
  feasibility crux, and it's not invented: a **Claude Code subagent** *is* a markdown file
  (frontmatter + system prompt); an **Agent Skill** is a `SKILL.md` folder that attaches via
  `skills: […]`; a **Managed Agent** is a versioned config (model + system + tools + MCP servers +
  skills + a `multiagent` coordinator roster) that runs in an Anthropic container. So markdown/config
  is the durable substrate — portable, reviewable, on-standard (the same thesis SkillSmith sells) —
  and the factory claim is carried by **composition**, not by generating compiled code.

> **Don't ship a lone file and call it a factory.** A single subagent markdown is SkillSmith with a
> relabel. The job is to forge a component *and set it into an agent* — the composition is the product.

New `ArtifactKind` members (`"agent" | "subagent" | "tool" | "connector" | "spawn-graph" | …`) and
new `Builder`/`Agent` domain modules; **no new architectural primitive.** That's the soundness test:
if agent-building needed a *new spine*, the seam was wrong. It doesn't.

---

## 6. The real departure — runnable agents

One thing genuinely breaks the current model, and it must be named honestly. SkillSmith is
instruction-only on purpose: a skill carries no runnable code, so a "test run" is a mock-tool
registry and there is **nothing to containerise** (`ARCHITECTURE.md §4`). That cleanliness ends at
**deploy.** These targets are **not speculative** — each maps to a shipping Claude runtime, which is
what makes "deploy to a managed container" credible rather than aspirational:

| Target | What it is | Concrete runtime | New surface area |
|---|---|---|---|
| **Download** | The agent as a folder/archive (skills + subagent defs + manifest). | Standard skill folder + agent manifest (`.zip`) | Lowest risk; reuses the export renderer. |
| **Install** | The same bundle, placed into a **host runtime the user controls**. | A **Claude Code `.claude/`** bundle — markdown subagents + `SKILL.md` skills + settings | Packaging + an install manifest; *we* still run nothing. |
| **Deploy** | A **managed container we run** that hosts the agent. | A **Managed Agent** config (agent YAML + MCP/vault wiring, optional schedule) on Anthropic-hosted containers | The big one: real execution, isolation, secrets/vaults, billing-by-runtime, the whole `ARCHITECTURE.md §9.1` safety surface — *amplified*, because now the agent acts. |

**Deploy is a one-way door** and should be the *last* phase, gated behind the safety work the Skill
Tap design (`§9.1`) sketched — harder here, because a deployed agent acts, not just advises. Download
and install are reachable far sooner — the Claude Code bundle is a near-term extension of today's
export. **Recommend: earn the agent-factory story on download/install (Claude Code bundle) first;
treat Managed-Agents deploy as a separate, safety-gated program.**

---

## 7. Roadmap (concept-level)

Ordered so each phase ships value and de-risks the next. Nothing here is a commitment — it's the
shape of the bet.

1. **Forge rebrand + Workshop/Forge modes.** Pure presentation: the **rename to AgentSmithing** (with
   a clearance pass, §4.3), the dynamic `AgentSmithing|<Builder>` wordmark, the **Forge** dark theme
   (forge-glow + binary-spark loader) beside the existing **Workshop** light theme. Reuses the
   two-theme machinery. *Lowest risk, highest visible signal — proves the brand before any domain work.*
2. **Agent as a first-class artifact (analysis only).** The `Agent` module + composition model; the
   **Forge** assembly view; Rendered/Source agent view + spawn-graph Visualise + agent export, all on
   the seam. No runtime. *Proves the seam generalizes.*
3. **Subagent + Tool builders.** The first two new builders beside the skill builder — apprentices and
   the agent's hands. *Proves "builders pluralise."*
4. **Connector builder.** MCP wiring + credential setup — how an agent touches real systems. *The step
   that makes agents useful, not just articulate.*
5. **Agent evals (Temper).** Test run + behavioural eval of the whole agent. *Lifts the validation
   thesis to agents.*
6. **Orchestrator + Guardrail builders.** The master-smith persona and the safety posture — the latter
   also seeds the §9.1 distribution-safety work.
7. **Download / install packaging.** The Claude Code bundle + install manifest. *The "take it with you" payoff.*
8. **Managed deploy (separate, safety-gated program).** Runtime, isolation, the amplified §9.1 safety
   surface. *Only when the rest is proven and the safety work is done.*

---

## 8. Open questions

- **Workshop/Forge — entry moment or just a toggle?** Default Workshop, switchable any time — but is
  there a one-time "light the forge?" first-run flourish, or is the toggle enough? (Affects onboarding,
  not architecture.)
- **How far does Forge motion reach?** Spark loaders + hammer micro-interactions only, or does it touch
  core interactions? More reach = more to design and test in *both* modes.
- **Does an agent compose existing skills, or only freshly-built ones?** An "acquire from my skill
  library" path pairs naturally with the deferred Skill Tap (§9.1).
- **How literal is delegation?** Is a subagent a real sub-loop the Orchestrator invokes at run time, or
  a build-time composition the host runtime parallelises? (Changes what "deploy" must run.)
- **Does managed deploy change billing** from per-token to per-runtime, and does that pull the deferred
  PAYG work forward?
