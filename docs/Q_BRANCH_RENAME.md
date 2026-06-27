# Q Branch rename — scope

> Scoping document for review. Not yet actioned. Describes the surface of
> renaming the **product/brand** from *SkillSmith* to *Q Branch* — and only the
> brand. The separate, larger work of broadening the domain language beyond a
> single primitive is tracked in [`AGENTEQUIP_PROPOSAL.md`](AGENTEQUIP_PROPOSAL.md)
> and is explicitly **out of scope** here.

## Thesis

*Q Branch* is a brand: the persona is Q, the equipper of secret agents, and
"branch" carries both the workshop/location sense and the git reference. The nod
to the source is **oblique by design** — no direct franchise references, just
copy in the spirit of *"where you go to equip your agents."* The name is also
deliberately primitive-agnostic, which is why it pairs with the AgentEquip
direction: *SkillSmith* names a single primitive; *Q Branch* names the place you
equip agents with whatever they need.

## The one distinction that scopes everything

The repo contains two different populations of the word "skill":

| Population | Scale | What it is | In scope? |
|---|---|---|---|
| **`SkillSmith`** (the brand) | 37 hits / 18 files | The product name | **Yes — this is the rename** |
| **`Skill` / `SKILL.md` / `write_skill` / `skill-analysis` …** | ~1,800 hits / 119 files | The *primitive* — the [Agent Skills open standard](https://agentskills.io) | **No — stays correct** |

The second population is the trap. "Skill" is the standard's word for the
artifact and remains valid under Q Branch; in the AgentEquip framing, Skill
becomes *one equipment primitive among several*. Renaming the `skill-analysis
seam` and friends to primitive-agnostic terms is the **product-broadening**
work, which the proposal gates behind a second primitive shipping. **Do not
touch it in the brand rename.**

## In scope — the brand surface (37 hits / 18 files)

### 1. User-facing copy (also where the persona lives)

This is the smallest, highest-leverage cluster — the only place a reader sees the
name, and the natural home for the "equip your agents" framing.

| File | Hit | Change |
|---|---|---|
| `src/components/top-bar.tsx:22` | wordmark `SkillSmith` | new wordmark + optional tagline |
| `src/app/layout.tsx:13` | page `<title>` | `Q Branch`; add a brand `description` meta |
| `src/components/interaction-panel.tsx:140` | "Tell SkillSmith what you want…" placeholder | rephrase to Q Branch / persona voice |
| `src/modules/build-loop/system-prompt.ts:7,19` | 2× "Do not mention SkillSmith…" (Claude's instructions) | rename the product reference |
| `src/modules/lint/lint-analyzer.ts:103` | lint message "…SkillSmith does not use it yet." | rename the product reference |

### 2. Docs (24 hits)

| File | Hits | Notes |
|---|---|---|
| `docs/ARCHITECTURE.md` | 10 | Title + thesis prose. Also carries ~6 `CrowBe/SkillSmith` issue links (see §repo). |
| `README.md` | 6 | Title, intro, the "working name" note (lines 8–9), `AGENTEQUIP` reference line. |
| `AGENTS.md` (← `CLAUDE.md` symlink) | 3 | Agent guide header + body. |
| `CONTEXT.md` | 2 | Domain-language doc title/intro — brand only; the *terms* stay. |
| `docs/AGENTEQUIP_PROPOSAL.md` | 2 | "SkillSmith is currently…" framing prose. |
| `docs/DESIGN.md` | 1 | Title. |
| `docs/MODULE_DESIGN.md` | 1 | Title. |
| `docs/architecture.html` | 3 | **Generated artifact** — regenerate from source rather than hand-edit. |

### 3. Config / infra

| File | Hit | Change |
|---|---|---|
| `package.json:2` | `"name": "skillsmith"` | package rename → `q-branch`. Lockfile root importer regenerates; no code imports the root package name. |
| `prisma/schema.prisma:1` | header comment | cosmetic |
| `src/app/globals.css:4` | header comment | cosmetic |
| `.env.example:2` | header comment | cosmetic |

### 4. Database name — rename to `qbranch` (decision: rename)

The DB name is **currently inconsistent**, so this pass fixes that too:

| File | Current value |
|---|---|
| `.env.example:8` | `…/skillbuilder?schema=public` ⚠️ *different from the others* |
| `README.md:97` | `…/skillsmith?schema=public` |
| `.github/workflows/ci.yml:13` | `…localhost:5432/skillsmith` |

Standardise all three on a single name (`qbranch`). Notes:
- These are **connection-string defaults**, not schema objects — changing them
  renames the target database, not any table/column. No Prisma migration is
  required for the rename itself.
- Any **already-provisioned** local/CI Postgres named `skillsmith`/`skillbuilder`
  must be recreated (or the URL pointed at a new DB) — the string change alone
  won't rename an existing database. CI spins a fresh container each run, so CI
  is just the string. Document this in the rename PR so contributors recreate
  their local DB.

### 5. GitHub repo links (decision: update links only)

`docs/ARCHITECTURE.md` hard-codes ~6 `github.com/CrowBe/SkillSmith/issues/N`
links. Rewrite these to the new repo path. The **actual repo rename is a
GitHub account-level action you perform separately**; GitHub auto-redirects old
URLs, so timing is not load-bearing, but the in-doc links should match the final
name.

## Out of scope (explicitly)

- Renaming the `Skill` primitive, `SKILL.md`, `write_skill`/`edit_skill`,
  `skill-analysis seam`, `skill_versions`, `skill-cap`, or any `skill`-named
  module, type, table, or tool. These are the standard primitive and code
  identifiers — see the AgentEquip proposal for when/whether they generalise.
- Shipping a second equipment primitive (the thing that *earns* the broader
  name). The brand can change first; the language generalisation follows the
  proposal's gate.
- Trademark / IP clearance for "Q Branch" as a commercial mark, and the
  potential collision with **Amazon Q**. Out of scope for this doc, but a
  prerequisite before the name is load-bearing externally (domain, repo,
  marketing).

## Suggested sequence (when greenlit)

1. **Copy + persona first** — the 5 user-facing files (§1). Smallest surface,
   immediately visible, where the "equip your agents" voice is set.
2. **Docs** (§2) — regenerate `architecture.html` rather than hand-edit it.
3. **Config + DB name** (§3, §4) — package name, comments, and the three
   connection strings standardised on `qbranch`; note the recreate-your-local-DB
   step in the PR.
4. **Repo links** (§5) — rewrite the in-doc issue URLs; you rename the repo on
   GitHub when ready.

Each step is independently reviewable and none touches the primitive language,
so the diff stays legible as a pure rebrand.
