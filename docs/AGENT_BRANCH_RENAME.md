# agent.branch — rename + branching-iteration scope

> Scoping document for review. Not yet actioned. Two linked changes:
> (1) rename the **product/brand** from *SkillSmith* to **agent.branch**, and
> (2) a **product direction** — reshape the iteration model to mirror git
> branching, so the name describes a mechanic rather than decorating one.
> The brand rename is well-scoped below; the branching model is **decided in
> shape** (safe-space iteration with opt-in merge) and awaits a build spec
> (§ Branching iteration). Broadening the domain
> language beyond a single primitive remains tracked in
> [`AGENTEQUIP_PROPOSAL.md`](AGENTEQUIP_PROPOSAL.md).

## Thesis

*agent.branch* drops the earlier *Q Branch* persona: "Q" carried real
James-Bond/EON trademark exposure (and an Amazon Q collision), and feedback
judged the copyright risk too high. Keeping **Branch** alone removes the franchise
reference entirely while retaining the part that was doing the work — *branch* as
both a git reference and the iteration model the product is moving toward. The
name stops being a pun and becomes the mental model: you **branch** an agent's
iterations the way you branch code.

## The name — identifier forms (the dot)

The dot is preferred in the **wordmark**, but it is stylistic, not structural, so
the technical identifiers split:

| Surface | Form | Why |
|---|---|---|
| Wordmark / display | `agent.branch` | lowercase + dot reads dev-native; the preferred brand styling |
| npm package | `agent.branch` (valid — cf. `socket.io`) | dots are allowed in npm names; matches the wordmark. Dotless `agent-branch` is the safe fallback |
| GitHub repo | `agent.branch` or `agent-branch` | dots are allowed in repo names; either works, redirect from the current repo |
| Postgres DB | `agent_branch` (**dotless, underscore — required**) | dots/hyphens force quoting in SQL; the DB name must not carry the dot |
| Env / CI vars | `agent_branch` | match the DB |

Net: the dot lives in everything user-facing and survives into the npm name; the
database and anything SQL-addressable uses `agent_branch`.

## The one distinction that scopes the rename

Two different populations of the word "skill" live in the repo:

| Population | Scale | What it is | In scope? |
|---|---|---|---|
| **`SkillSmith`** (the brand) | 37 hits / 18 files | The product name | **Yes — this is the rename** |
| **`Skill` / `SKILL.md` / `write_skill` / `skill-analysis` …** | ~1,800 hits / 119 files | The *primitive* — the [Agent Skills open standard](https://agentskills.io) | **No — stays correct** |

"Skill" remains the standard's word for the artifact. Renaming the
`skill-analysis seam` and friends is the **product-broadening** work the
AgentEquip proposal gates behind a second primitive — **do not touch it in the
brand rename.**

## In scope — the brand surface (37 hits / 18 files)

### 1. User-facing copy (where the branching story lands)

The smallest, highest-leverage cluster — the only place a reader sees the name,
and the natural home for the "iterate like you branch" framing.

| File | Hit | Change |
|---|---|---|
| `src/components/top-bar.tsx:22` | wordmark `SkillSmith` | new wordmark `agent.branch` + optional tagline |
| `src/app/layout.tsx:13` | page `<title>` | `agent.branch`; add a brand `description` meta |
| `src/components/interaction-panel.tsx:140` | "Tell SkillSmith what you want…" placeholder | rephrase to agent.branch voice |
| `src/modules/build-loop/system-prompt.ts:7,19` | 2× "Do not mention SkillSmith…" | rename the product reference |
| `src/modules/lint/lint-analyzer.ts:103` | lint message "…SkillSmith does not use it yet." | rename the product reference |

### 2. Docs (24 hits)

| File | Hits | Notes |
|---|---|---|
| `docs/ARCHITECTURE.md` | 10 | Title + thesis prose; ~6 `CrowBe/SkillSmith` issue links (see §5). |
| `README.md` | 6 | Title, intro, the "working name" note (lines 8–9). |
| `AGENTS.md` (← `CLAUDE.md` symlink) | 3 | Agent guide header + body. |
| `CONTEXT.md` | 2 | Domain-language doc title/intro — brand only; the *terms* stay. |
| `docs/AGENTEQUIP_PROPOSAL.md` | 2 | Framing prose. |
| `docs/DESIGN.md` | 1 | Title. |
| `docs/MODULE_DESIGN.md` | 1 | Title. |
| `docs/architecture.html` | 3 | **Generated artifact** — regenerate from source, don't hand-edit. |

### 3. Config / infra

| File | Hit | Change |
|---|---|---|
| `package.json:2` | `"name": "skillsmith"` | → `agent.branch` (or `agent-branch`) |
| `prisma/schema.prisma:1`, `src/app/globals.css:4`, `.env.example:2` | header comments | cosmetic |

### 4. Database name — standardise on `agent_branch`

The DB name is **currently inconsistent**, so this pass fixes it:

| File | Current value |
|---|---|
| `.env.example:8` | `…/skillbuilder?schema=public` ⚠️ *differs from the others* |
| `README.md:97` | `…/skillsmith?schema=public` |
| `.github/workflows/ci.yml:13` | `…localhost:5432/skillsmith` |

Standardise all three on `agent_branch` (underscore, SQL-safe). Notes:
- These are **connection-string defaults**, not schema objects — no Prisma
  migration is needed for the rename itself.
- An already-provisioned local/CI database must be recreated (or the URL pointed
  at a fresh DB); the string change alone won't rename an existing database. CI
  spins a fresh container each run. Note the recreate-your-local-DB step in the
  rename PR.

### 5. GitHub repo links

`docs/ARCHITECTURE.md` hard-codes ~6 `github.com/CrowBe/SkillSmith/issues/N`
links — rewrite to the new repo path. The **actual repo rename is a GitHub
account-level action you perform separately**; GitHub auto-redirects old URLs.

## Branching iteration — product direction (OPEN)

The reason "Branch" survives the rename: the iteration model moves to mirror git.

**Where iteration is today.** `skill_versions` is an **append-only linear
history** (ARCHITECTURE §6): each revision is a new head, retention keeps the
latest 10, and *restore-a-version lands as a new head* — a straight line, never a
fork. The build loop advances that line one revision at a time, and **eval
feedback** (CONTEXT.md) injects an evaluation/lint result back so Claude revises
toward the next linear head. Regression comparison — *"did this revision make the
agent better or worse?"* — is **deferred** (ARCHITECTURE §9; AgentEquip proposal
gap #2).

**What "reflect git branching" adds.** The git mapping is already latent in the
architecture:

| git | agent.branch equivalent |
|---|---|
| commit | a skill revision (`skill_version`) |
| CI on a commit | an **evaluation result** on a revision |
| branch | a named, divergent line of iteration off a shared parent revision |
| diff between commits | **regression comparison** — the deferred behavioural compare, now first-class |
| merge | promote a winning iteration line back to the main line |

This gives the deferred regression-comparison feature a real home, and
generalises the current *linear* model (restore = new head) into a **tree**,
which is how people actually iterate: try a direction, fall back, try another.
It also composes with AgentEquip — eventually you branch a *bundle* of
primitives, not just a skill.

**The tension to resolve.** The bridge audience (ARCHITECTURE §1) is half
non-technical SMB owners; branch/merge/diff is developer furniture. The
commitment is *approachable without dumbing down* — so the git model should shape
the **architecture and data model** without forcing git vocabulary onto the
SMB-facing UI.

**Decided model — safe-space iteration with opt-in merge.** The chosen value is
*safety*: the blessed version never changes until the user chooses. Each
iteration runs on a **branch** off the chosen version; the build loop and its
evals operate there, touching nothing live; when the evidence is good the user
**opts in to a merge** that promotes the branch into the chosen version.

Consequences for the architecture:

- **A chosen-version pointer ("main"), separate from branch heads** — the one
  genuinely new concept vs. today, where "current" is simply the latest
  append-only head (so every edit mutates what the user sees; there is no safe
  space). The pointer creates the safe space.
- **The build loop operates on the active branch**, not the chosen version.
  Eval feedback runs against the branch head. Nothing blessed moves until merge.
- **Merge = adopt, not reconcile.** Load-bearing simplification: as long as the
  chosen version only advances *through* a merge (never edited concurrently),
  every merge is a fast-forward — point main at the branch head. No three-way
  merge, no conflict resolution. This is what keeps real branch/merge out of
  full-git-model cost. **Invariant to hold explicit: the chosen version is
  immutable between merges** (true for one user iterating one skill).
- **Merge-when-green.** The opt-in gate is where the existing eval loop pays off:
  branch → iterate + evaluate safely → merge only when the triggering eval /
  test run says it is good. Validation becomes the gate on the core mechanic
  rather than a side surface.

Open sub-decisions (smaller, resolved at spec time): branch retention vs. the
latest-10 version cap; whether branches are named or ephemeral; UI vocabulary for
the bridge audience ("branch / merge" taught lightly vs. "draft / keep changes").
When this becomes a build spec, the data-model + UI decisions land in
`ARCHITECTURE.md` (§6 data model, §3 the seam), not here.

## Out of scope

- Renaming the `Skill` primitive, `SKILL.md`, `write_skill`/`edit_skill`,
  `skill-analysis seam`, `skill_versions`, or any `skill`-named module/type/table
  — the standard primitive and code identifiers stay.
- Shipping a second equipment primitive (the AgentEquip gate).
- Trademark clearance for "Branch" as a mark (lower risk than Q, but note
  existing "Branch" companies — Branch.io, Branch Insurance — in adjacent spaces;
  a search is still warranted before the name is externally load-bearing).

## Suggested sequence (when greenlit)

1. **Copy first** — the 5 user-facing files (§1); set the agent.branch voice.
2. **Docs** (§2) — regenerate `architecture.html` rather than hand-edit.
3. **Config + DB name** (§3, §4) — package name, comments, connection strings on
   `agent_branch`; note recreate-your-local-DB in the PR.
4. **Repo links** (§5) — rewrite in-doc issue URLs; rename the repo on GitHub when
   ready.
5. **Branching iteration** — separate track, starts only after the §Branching
   decision; lands in `ARCHITECTURE.md`, not here.

Each rename step is independently reviewable and none touches the primitive
language, so the diff stays a pure rebrand.
