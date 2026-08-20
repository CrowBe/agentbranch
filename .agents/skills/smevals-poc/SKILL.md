---
name: smevals-poc
description: Operate the removable validation-harness smevals PoC (issue #301) — validate, smoke, full, resume, regrade, and report flows via pinned npm scripts.
---

# Validation-harness smevals PoC (issue #301)

The repository carries a removable, offline-safe proof of concept that evaluates
AgentBranch's validation-harness behaviour through the pinned third-party
orchestrator `smevals==0.2.0`. All orchestration lives in
`scripts/smevals-poc.mjs`; this skill only names the supported operator path.

## Invariants (from the canonical docs)

- **Harness** always means AgentBranch's versioned validation harness
  (`harness_versions`) — never the model gateway, never a user's imported setup
  (that is an **agent configuration**). See `CONTEXT.md` → *Distinctions*.
- smevals Task / Config / Run / Grade vocabulary stays inside
  `eval/validation-harness/` and this skill. It never enters product modules.
- The evaluator sits outside the loop it judges (`docs/ARCHITECTURE.md` §10):
  execution evidence is immutable and judgements are versioned and independent.
- The PoC is credential-free and model-spend-free: the Runner is a deterministic
  mock and every invocation is pinned to `uvx --from smevals==0.2.0 smevals`.
  Nothing adds smevals or Python to the production manifest.

## Commands

Run from the repository root. Every command is a pinned npm script; do not
invent ad-hoc smevals invocations.

| Flow | Command | What it proves |
|---|---|---|
| Validate | `npm run poc:validate` | Deterministic matrix (two Configs × six scenario Tasks + one crash Task), scenario coverage, executable Runner/Checkers, artifact contract, no smevals import under `src/`, gitignore of generated output. No smevals execution. |
| Smoke | `npm run poc:smoke` | One successful sample per pair, graded; infrastructure-failure Task retained in `.poc/runs-infra/`, never graded. |
| Full matrix | `npm run poc:full` | Every Task/Config pair topped up to three successful samples (idempotent). |
| Resume | `npm run poc:resume` | Topping up from on-disk runs never duplicates completed samples. |
| Regrade | `npm run poc:regrade` | Grades are regenerated from stored runs with `--regrade`; run evidence is untouched (no Runner execution). |
| Markdown report | `npm run poc:report` | `smevals report --by-task` plus an infrastructure-failure appendix; written to `.poc/reports/validation-harness-report.md`. |
| Static HTML report | `npm run poc:report:html` | `smevals build` site at `.poc/reports/site/index.html`. |

The vitest contract suite (`npm test` → `src/meta/smevals-poc.test.ts`) runs the
focused Runner contract suite and static contract always, plus the
smoke/resume/regrade semantics whenever `uv` is available.

## Interpreting results

- A `1.00` score means the deterministic Runner produced the expected
  provider-neutral trace and complete secret-free evidence for every sample.
- Graded statistics come from the scenario Tasks only. Infrastructure-failure
  runs (non-zero Runner exit) are retained in `.poc/runs-infra/` and listed in
  the report appendix; they are **never** graded as model/agent-configuration
  failures.
- A regression shows up as a failed grade or an evidence problem
  (missing artifact, secret-shaped content, wrong tool/arguments). Re-run
  `poc:regrade` after editing a Grader, then `poc:report` to confirm.

## Cleanup and removal

Generated runs and reports are gitignored (`/eval/validation-harness/runs/`,
`/.poc/`). To remove the PoC entirely, delete `eval/validation-harness/`,
`scripts/smevals-poc.mjs`, `src/meta/smevals-poc.test.ts`, the
`.github/workflows/smevals-poc.yml` workflow, the `poc:*` npm scripts, and the
`docs/ARCHITECTURE.md` / `docs/MODULE_DESIGN.md` PoC prose. No production
runtime code changes.
