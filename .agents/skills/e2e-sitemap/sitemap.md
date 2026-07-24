# agent.branch — bot-friendly sitemap & E2E walk spec

Machine-followable map of the whole app surface. Read the protocol in
`SKILL.md` first (status-line sync, dialog policy, offline expectations).
Base URL: `http://localhost:3000`. All copy strings below are exact and were
validated against the running app; `walk-runner.mjs` in this folder is the
executable form of this spec (run `node .agents/skills/e2e-sitemap/walk-runner.mjs`
from the repo root against a fresh dev server).

## 1. Node inventory

### Pages

| Node | Path | Render | Notes |
|---|---|---|---|
| Workspace | `/` | server → client workspace | The whole product surface; everything below hangs off it |
| Public skill profile | `/skills/[owner]/[name]` | server, force-dynamic | 404 for missing/private slugs; badge or `potentially unsafe — not validated` label when a publication exists |

### Workspace navigation (side rail)

Match nav buttons by **accessible name** — `getByRole("button", { name: … })`.
The rail is a collapsed icon rail (name = `aria-label`) that expands on hover
into a labelled slideout (name = visible text, `aria-label` gone), so a CSS
`[aria-label=…]` selector breaks mid-run; the role query works in both states.

| Nav node | Accessible name | Interaction-panel mode it opens |
|---|---|---|
| Build | `Build` | `Describe your skill` — chat drives the build loop |
| Import | `Import` | `Import a skill` — paste `SKILL.md` or a public GitHub URL |
| My skills | `My skills` | saved-skill list with `Open` cards |
| Equipment | `Equipment` | paste a response schema / tool contract / subagent definition, or chat-author one |
| History | `History` | revision + run entries, restore cards |
| Templates | `Templates` | reviewed Skill-library entries + search |
| Models | `Models` | model console overlay (admin-gated when auth is on) |

### Hero surface (always mounted on `/`)

| Node | Selector | Behaviour |
|---|---|---|
| View toggle | buttons `Rendered` / `Source` | two renderers of the same skill; Rendered is default |
| Quality chip | `button[aria-label^="Quality"]` | pure lint — works offline, zero tokens |
| Metadata chip | button `Metadata` | editable name, description, category + tags; local → gateway → deterministic ladder |
| Visualise chip | button `Visualise` | skill IR → Mermaid; deterministic fallback offline |
| Run chip | button `Run` | test run (evaluation — needs a model) |
| Triggers chip | button `Triggers` | triggering eval (evaluation — needs a model) |
| Safety chip | button `Safety` | safety rating (evaluation — needs a model) |
| Export chip | button `Export` | standard skill folder manifest; works offline |
| Draft controls | buttons `Start a draft` / `Set as main version` / `Discard draft` | banner `Editing a draft` vs `Viewing the main version` |
| Publish | button `Publish` (main version only) | opens `Publish skill` form for the public `owner/name` address; submit reaches `/api/publications` |
| Status line | `[role="status"]` | the synchronisation point for every step |

### Top bar

| Identity state | Quota pill |
|---|---|
| signed out | `Create account for $1 credit` — no anonymous platform-funded model allowance |
| signed in | remaining dollar balance, e.g. `$1.00 free quota`; refreshed after model-bearing actions |

### Confirm dialogs (native `confirm()`)

| Trigger | Message starts with | Offline policy |
|---|---|---|
| Set as main version | `Set this draft as your main version?` | accept |
| — follow-up offer | `Optional: run a safety rating on this draft first?` | **dismiss** — accepting runs a model-costing safety rating; offline it fails and aborts the promote |
| — non-passing verdict | `The safety rating is …` | accept to promote anyway |
| Discard draft | `Discard this draft?` | accept |
| Restore (History) | restore confirmation | accept |

### API surface

Skill-carrying POSTs take a structured source, not raw `SKILL.md` text:
`{ "skill": { "frontmatter": { "name", "description" }, "body" } }`.
Equipment quality routes take `{ "document": "<source string>", "surface": "insights" | "breakdown" }`.

| Route | Method | Auth | Offline (no model / memory adapters) |
|---|---|---|---|
| `/api/build` | POST (SSE) | signed-in | stream opens; model error surfaces as streamed error event |
| `/api/import` | POST | signed-in | works (GitHub URL fetch needs a token; paste always works) |
| `/api/skills/[id]` | GET, PATCH, DELETE | signed-in | works — PATCH appends an accepted metadata revision to main or the active draft |
| `/api/lint` | POST | signed-in | works — pure analysis |
| `/api/visualise` | POST | signed-in | works — deterministic fallback |
| `/api/export` | POST | signed-in | works — pure analysis |
| `/api/metadata-suggest` | POST | signed-in | works — keyword fallback |
| `/api/usage` | GET | signed-in | remaining free-quota balance; refreshed after model-bearing workspace actions |
| `/api/test-run` | POST (SSE/JSON) | signed-in | **503** `model_unavailable` before any stream opens |
| `/api/triggering-eval` | POST (SSE/JSON) | signed-in | **503** `model_unavailable` |
| `/api/safety-review` | GET, POST | signed-in | GET works (rating lookup); POST **503** offline |
| `/api/response-schema` | POST | signed-in | works — pure quality check |
| `/api/response-schema/build` | POST (SSE) | signed-in | stream opens; provider-key error streamed |
| `/api/tool-contract` | POST | signed-in | works — pure quality check |
| `/api/tool-contract/build` | POST (SSE) | signed-in | stream opens; provider-key error streamed |
| `/api/subagent-definition` | POST | signed-in | works — pure quality check |
| `/api/subagent-definition/build` | POST (SSE) | signed-in | stream opens; provider-key error streamed |
| `/api/equipment` · `/api/equipment/[id]` | GET/POST/DELETE | signed-in | works against memory adapters; checked documents are saved account-side |
| `/api/skills` · `/api/skills/[id]` · `…/restore` · `…/runs` · `…/branches[...]` | GET/POST/DELETE | signed-in | work against memory adapters (state resets on restart) |
| `/api/skill-library` (`?surface=templates`, `?q=`, `?category=`, `?tag=`, `?slug=`) | GET | public read | works — pure read over publications |
| `/api/publications` | POST | signed-in | works offline (memory) — publishes the user's main version |
| `/api/tap-repository` | GET | public read | works — pure file-set render |
| `/api/model-router` | GET, POST | admin (open when auth off) | works — secret-free snapshot / selection |
| `/api/admin/harness-report` | GET | admin | works — static correlation |
| `/api/admin/benchmark` | GET, POST | admin | GET works; POST **503** offline |
| `/api/cron/retention` | GET | `Authorization: Bearer $CRON_SECRET` | **401 — locked** (fail-safe) when secret unset |

## 2. Walk paths

Run in order for a full pass. `precondition: WALK-01` means the walk needs the
imported skill from this server session (memory resets on restart — and the
skill-count cap is five per account, so repeated import runs against one server
session eventually hit `You're at your skill limit - delete a skill to make
room.`; **restart the dev server for a clean session**).

Fixture used by WALK-01 (paste as-is):

```markdown
---
name: inbox-triage
description: Sort unread email into respond, archive, and escalate piles.
---

# Inbox triage

## Workflow
1. Fetch unread email.
2. Classify each message as respond, archive, or escalate.
3. Summarise the respond pile.
```

### WALK-01 · Import (seeds session state)

| # | action | selector | expect (`[role="status"]` unless noted) |
|---|---|---|---|
| 1 | goto `/` | — | page 200; hero renders a skill document |
| 2 | click | nav button `Import` | panel title `Import a skill` |
| 3 | fill fixture, click | `textarea`, then button `Import skill` | `Importing…` → `Import complete.` |
| 4 | assert | hero heading | title reflects `inbox-triage` |

### WALK-02 · Hero views

precondition: WALK-01

| # | action | selector | expect |
|---|---|---|---|
| 1 | click | button `Source` | monospace raw `SKILL.md` incl. frontmatter text |
| 2 | click | button `Rendered` | friendly document view returns |

### WALK-03 · Quality (lint)

precondition: WALK-01 · offline-safe

| # | action | selector | expect |
|---|---|---|---|
| 1 | click | `button[aria-label^="Quality"]` | `Quality running…` → `Quality ready.` |
| 2 | assert | capability panel | Insights renders (score/grade + findings); Breakdown tab renders the full finding list |

### WALK-04 · Visualise

precondition: WALK-01 · offline-safe (deterministic fallback)

| # | action | selector | expect |
|---|---|---|---|
| 1 | click | button `Visualise` | `Visualise running…` → `Visualise ready.` |
| 2 | assert | capability panel | Mermaid diagram (or its source block fallback) renders |

### WALK-04B · Metadata suggestion

precondition: WALK-01 · offline-safe; the documented runner has no local model, while a compatible Chrome installation may serve the local rung

| # | action | selector | expect |
|---|---|---|---|
| 1 | click | button `Metadata` | `Metadata running…` → `Metadata ready.` |
| 2 | assert | capability panel | same editable name, description, category, tags + rationale shape on every rung; provenance is `Metadata suggestion` for the route or `Suggested on your device` for the local rung |
| 3 | click | button `Apply suggestion` | `Suggestion applied and saved.`; hero returns to the author-owned document |

### WALK-05 · Export

precondition: WALK-01 · offline-safe

| # | action | selector | expect |
|---|---|---|---|
| 1 | click | button `Export` | `Export running…` → `Export ready.` |
| 2 | assert | capability panel | standard skill folder manifest (`inbox-triage/SKILL.md`) listed |

### WALK-06 · My skills → open

precondition: WALK-01

| # | action | selector | expect |
|---|---|---|---|
| 1 | click | nav button `My skills` | `Loading skills…` → panel lists `inbox-triage` |
| 2 | click | `Open` on the entry card | `Opening skill…` → `Skill opened.` |
| 3 | assert | draft controls | `Viewing the main version` + button `Start a draft` |
| 4 | assert | publish control | button `Publish` is available for the main version |

### WALK-07 · Draft lifecycle (start → promote, start → discard)

precondition: WALK-06 · dialog policy from §1 required

| # | action | selector | expect |
|---|---|---|---|
| 1 | click | button `Start a draft` | `Starting a draft…` → `Draft started. Your main version is unchanged.` |
| 2 | assert | draft banner | `Editing a draft` |
| 3 | click (accept promote confirm, **dismiss** safety-rating offer) | button `Set as main version` | `Setting as main version…` → `This draft is now your main version.` |
| 4 | click | button `Start a draft` | `Draft started. Your main version is unchanged.` |
| 5 | click (accept confirm) | button `Discard draft` | `Discarding draft…` → `Draft discarded. Back to your main version.` |
| 6 | assert | draft controls | back to `Viewing the main version` |

### WALK-08 · Offline evaluation probes (only when no model key is configured)

precondition: WALK-01 · asserts the graceful degradation, one chip at a time

| # | action | selector | expect |
|---|---|---|---|
| 1 | click | button `Run` | error status `No model is configured.`; chip re-enables |
| 2 | click | button `Triggers` | `No model is configured.`; chip re-enables |
| 3 | click | button `Safety` | `No model is configured.`; chip re-enables |

With a model key configured, replace with: `Run` → `Test run ready.`,
`Triggers` → `Triggering eval ready.`, `Safety` → `Safety rating ready.` —
these spend tokens.

### WALK-09 · History

precondition: WALK-07 (needs revisions to list) · dialog policy required for restore

| # | action | selector | expect |
|---|---|---|---|
| 1 | click | nav button `History` | `Loading history…` → `History loaded.` |
| 2 | assert | panel | revision entries (and run entries when evals have run) |
| 3 | (optional) click restore on an older revision (accept confirm) | restore card | `Restoring…` → `Version restored.` |

### WALK-10 · Equipment

independent · offline-safe for the paste path

| # | action | selector | expect |
|---|---|---|---|
| 1 | click | nav button `Equipment` | `Loading equipment…` → `No saved equipment yet.` (or `Equipment loaded.`); panel title `Equipment` |
| 2 | fill plain language (e.g. `a schema for invoice summaries`), click | `textarea`, then button `Send` | routes to the chat authoring loop; **offline** it fails with `No API key for "<provider>". Add one in the model console or .env.local.` |
| 3 | fill a JSON Schema (`{"title":"Invoice summary","type":"object",…}`), click | `textarea`, then button `Send` | `Checking response schema…` → `Response schema "Invoice summary" checked and kept for tool contracts to reference.` |
| 4 | fill a tool contract (`{"name":"fetch_unread_email","description":…,"input":…,"output":…}`), click | `textarea`, then button `Send` | `Checking tool contract…` → `Tool contract "fetch_unread_email" checked — it runs with your next test run.` |
| 5 | fill frontmatter markdown (`name: invoice-reviewer`, `description: …`, body instructions), click | `textarea`, then button `Send` | `Checking subagent definition…` → `Subagent definition "invoice-reviewer" checked and kept.` |
| 6 | click the subagent definition card's `Open` | subagent definition card button `Open` | `Subagent definition "invoice-reviewer" opened.`; hero heading `invoice-reviewer`; Rendered/Source toggle remains available |
| 7 | click the hero quality chip, then `Breakdown` | `button[aria-label^="Quality"]`, then button `Breakdown` | `Quality ready.`; Breakdown heading remains `Subagent definition quality` and posts the definition to `/api/subagent-definition` |
| 8 | click | button `Back to skill` | `Skill opened.` and the skill-only chips return |

Routing rule: frontmatter markdown with string `name` + `description` → subagent definition;
JSON object with string `name` + `description` → tool contract; other JSON object → response schema
(named by `title`); anything else → a chat turn for the authoring loop. Checked contracts bundle
into the next test run automatically.

### WALK-11 · Templates / Skill library

independent · offline-safe (pure read; empty when no publications exist)

| # | action | selector | expect |
|---|---|---|---|
| 1 | click | nav button `Templates` | `Loading Templates…` → `No Templates yet.` (empty) or `Templates loaded.` |
| 2 | fill `inbox`, click | `textarea`, then button `Search` | `Searching…` → `No matching Templates.` (empty) or `Templates search loaded.` |
| 3 | (with publications) search an `owner/name` slug | same | `Skill library entry loaded.` |

### WALK-12 · Model console

independent · open when auth is off (dev); admin-gated when auth is on

| # | action | selector | expect |
|---|---|---|---|
| 1 | click | nav button `Models` | console overlay opens with provider/model selection |
| 2 | assert | overlay | secret-free snapshot — no key material anywhere in the DOM |

### WALK-13 · Public profile page

independent

| # | action | selector | expect |
|---|---|---|---|
| 1 | goto `/skills/nobody/does-not-exist` | — | 404 |
| 2 | (with a publication) goto its `/skills/<owner>/<name>` | — | 200; rendered skill + trust tier + safety badge or `potentially unsafe — not validated` label |

### WALK-14 · API probes (curl-level, no browser)

independent · request shapes in §1

| # | probe | expect |
|---|---|---|
| 1 | `POST /api/lint` with a structured skill source | 200 JSON insights |
| 2 | `POST /api/test-run` offline | 503, `model_unavailable` |
| 3 | `GET /api/skill-library?surface=templates` | 200 JSON feed |
| 4 | `GET /api/tap-repository` | 200 file set (`.claude-plugin/marketplace.json` + `skills/**`) |
| 5 | `GET /api/cron/retention` without bearer secret | 401 — locked |
| 6 | `GET /api/model-router` (auth off) | 200 snapshot with no key material in the body |

## 3. Qualitative audit — gaps the walks can't see

The walks in §2 assert *structure*: exact copy, selectors, status transitions.
They stay green while the experience quietly degrades — a merged module no
user can reach, a primitive that ships second-class, a quality signal that
grades everything A. This section is the **agent-judged pass** for those gaps.
The walk runner cannot execute it; you read source, probe routes, take
screenshots, and judge.

Run it on every full validation pass, and whenever a change adds a domain
module or touches the workspace. Each audit reports `OK` or a named
**finding** with evidence. Findings never flip a walk red — they go in the
report, and on an autonomous pass they get filed as GitHub issues (one per
distinct gap, referencing the audit id and evidence) after checking open
issues for a duplicate. A finding that is a *deliberate, recorded* gap — an
issue link in the tables below — is not re-reported.

### QUAL-01 · Surface-parity matrix

Every primitive should meet the core experience, or the gap should be a
recorded decision. Re-derive this matrix from the running app and
`src/components/workspace/workspace.ts` + `hero-panel.tsx`, then diff it
against the recorded state below. A new primitive row, a regressed cell, or
an unrecorded `no` is a finding.

Recorded state (update in the same change that truly moves a cell):

| Core experience | Skill | Response schema | Tool contract | Subagent definition |
|---|---|---|---|---|
| Hero document view (Rendered/Source) | yes | yes | yes | yes |
| Quality Insights panel | yes (chip + panel) | yes, after check/authoring | yes | yes |
| Quality Breakdown panel | yes | yes | yes | yes |
| Chat authoring loop | yes | yes | yes | yes |
| Persistence beyond the session | yes (skill records + drafts) | yes | yes | yes |
| History / past runs | yes | no — accepted gap (#218 non-goals) | no | no |
| Export | yes | no — accepted gap (#218 non-goals) | no | no |
| Publish / Skill library | yes | no — accepted gap (#218 non-goals) | no | no |

### QUAL-02 · Module-reachability ledger

Every domain module in MODULE_DESIGN §4 must either reach a node in §1 (page,
nav mode, chip, or API route) or appear in this ledger. A module in neither
place — the signature of a backend-only PR shipping a capability no user can
touch — is a finding naming the module and the change that added it. Adding a
ledger row requires stating why no surface is expected, not just listing the
module.

Internal by design (no user surface expected):

| Module | Why internal |
|---|---|
| `skill-analysis` | the seam itself |
| `model-gateway` · `model-router` | platform plumbing; the model console is the router's surface |
| `usage` | accounting authority behind the quota pill |
| `auth` · `skill-import` | ports (import reached via `/api/import`) |
| `harness-version` | identity stamping for evaluation records |
| `baseline-corpus` | frozen ground for the regression benchmark |
| `response-schema-corpus` | frozen characterisation ground for schema lint (#211); feeds the benchmark, not a surface |
| `regression-benchmark` · `harness-recommendation` | admin surfaces (`/api/admin/*`) |
| `build-loop` | reached through `/api/build` + the equipment authoring routes |

### QUAL-03 · Quality-signal sensitivity probes

A quality capability that grades nearly everything the same is decorative.
Probe each lint surface with one clean and one deliberately flawed input; a
flawed input scoring within 5 points of the clean one **and** keeping its
grade letter is a finding — report both scores as evidence.

| Probe | Clean input | Flawed input | Route |
|---|---|---|---|
| Skill lint | the WALK-01 fixture | same, description `Does stuff.`, one-line body | `POST /api/lint` |
| Response schema | the WALK-10 step-3 schema (titled, described, closed, required fields) — A 100 | `required: []` — B 85 · `additionalProperties: true` — B 85 · both defects — C 70 | `POST /api/response-schema` |
| Tool contract | complete `send_invoice_reminder` fixture (closed input, described properties, example, failure modes, safety notes) — A 100 | same with description `Does stuff.` and no failure modes — B 76 | `POST /api/tool-contract` |

Known baseline: the `response-schema-corpus` module freezes the expected
response-schema sensitivity: either single structural defect costs 15 points
and one grade letter; combining both costs 30 points and reaches C. Skill lint
also passes the probe (B 82 clean → D 58 flawed). The executable
`tool-contract.test.ts` probe freezes tool-contract sensitivity at A 100 clean
→ B 76 flawed; both documents remain valid tool contracts.

### QUAL-04 · Judgment screenshots

Screenshot each nav mode's panel plus the hero in both views, and judge:

- **Domain language** — glossary terms only in user copy: "test run" never
  "sandbox", "draft" never "branch", "Set as main version" never "promote"
  (CONTEXT.md).
- **Tone** — warm-pro, sentence case, no data walls (DESIGN §1); numbers are
  always accompanied by meaning.
- **Empty states** — every mode's empty state says what to do next, not just
  that nothing is there.
- **Degradation copy** — offline/error states read as friendly assertions
  (`No model is configured.`), never stack traces or raw error tags.

Report drifted copy verbatim (old → judged problem).

### Reporting

Append a `QUAL` section to the walk matrix — one line per audit:
`QUAL-01 OK` or `QUAL-01 FINDING: <one line + evidence pointer>`. On an
autonomous pass, file each new finding as a GitHub issue and link it from the
relevant table above in the same change.
