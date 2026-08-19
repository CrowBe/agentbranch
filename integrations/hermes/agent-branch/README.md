# agent-branch — a Hermes plugin

agent.branch's configuration and eval capabilities, brought to
[Hermes Agent](https://github.com/NousResearch/hermes-agent) profiles. A
Hermes profile (`~/.hermes` or `~/.hermes/profiles/<name>/`) is an agent
configuration — config, persona, memory, skills — and this plugin gives each
one the two things agent.branch is built around:

- **Profile analysis** — a pure, offline pass over one profile's
  configuration surface: deterministic findings with exact file/line
  evidence, an actionable fix per finding, and a 0–100 quality score.
  Costs no tokens; the same profile always yields the same artifact.
- **Triggering eval** — does a skill *fire* on prompts that should select
  it and *stay silent* on near-misses that shouldn't? The evaluator builds
  its own prompt battery and runs it against a selection roster where the
  profile's sibling skills act as the distractor library. Results render as
  plain-language **Insights**, never as a raw data wall, and persist as
  append-only records.

Model access goes exclusively through Hermes' `ctx.llm` — the host-owned,
audited, credential-free entry to whatever model the user is running. The
plugin owns its evaluation *method*; it never owns model *resources*. Every
call carries a `purpose` tag (`agent-branch.triggering-eval.*`) so spend is
attributable in `agent.log`.

## Surfaces

| Surface | What |
|---|---|
| `/branch profiles` | Profiles with quality scores |
| `/branch analyze [profile]` | Rendered profile analysis |
| `/branch eval <skill> [profile]` | Run a triggering eval (costs tokens) |
| `/branch insights [profile]` | Past run Insights |
| `hermes agent-branch …` | The same four verbs from the terminal |
| Tools | `agent_branch_profiles`, `agent_branch_analyze`, `agent_branch_triggering_eval` — the agent can run its own review |
| Desktop pane | Read-only: scores, findings, past Insights (`desktop/plugin.js`) |
| Backend | `GET /api/plugins/agent-branch/{profiles,analysis,insights}` (`dashboard/plugin_api.py`) |

The pane is deliberately read-only for evals: analysis recomputes freely
because it is offline; anything that spends tokens stays on the agent
surfaces where spend is visible and intentional.

## Install

```bash
hermes plugins install CrowBe/agentbranch/integrations/hermes/agent-branch
hermes plugins enable agent-branch
```

Two enable switches apply, both off by default: `plugins.enabled` in
`config.yaml` gates the Python half (tools, commands, backend), and
**Settings → Plugins** in Hermes Desktop gates the pane. The pane degrades
gracefully while the backend half is off.

Settings (under `plugins.entries.agent-branch.settings`): `battery_size`
(prompts per side of an eval battery, default 4), `max_skills` (analysis
bound, default 64), `eval_timeout` (per-call seconds, default 60).

## What it reads — and never reads

Analysis reads only the configuration surface: `config.yaml` (parse status
only — no values enter findings), `SOUL.md`, `memories/MEMORY.md`,
`memories/USER.md`, and each `skills/*/SKILL.md`. It never reads `.env`,
`auth.json`, credentials, or session history, and nothing it reads is ever
executed. Reads are bounded (256 KiB per file, `max_skills` skills).

## Cost

Analysis is free. One triggering eval makes `2 × battery_size + 2` model
calls (battery generation, one selection per prompt, one Insight), against
the user's active provider at their expense.

## Layout

```
agent-branch/
├── plugin.yaml          # manifest (v2)
├── __init__.py          # register(ctx): tools, /branch, CLI
├── schemas.py           # tool schemas the LLM reads
├── profiles.py          # profile discovery + bounded snapshots
├── analysis.py          # profile analysis (pure, deterministic)
├── triggering_eval.py   # triggering eval via ctx.llm + Insights renderer
├── records.py           # persisted evaluation records
├── dashboard/           # backend routes (gateway process)
└── desktop/plugin.js    # Hermes Desktop pane (no-build ESM)
```

`profiles.py`, `analysis.py`, `triggering_eval.py`, and `records.py` are
stdlib-only and import no siblings, so the dashboard backend loads them by
file path and they test standalone. Validate a checkout with
`hermes plugins doctor integrations/hermes/agent-branch --ci`.
