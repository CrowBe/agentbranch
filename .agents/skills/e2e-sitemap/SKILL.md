---
name: e2e-sitemap
description: Agent-driven end-to-end validation of agent.branch — a bot-friendly sitemap (sitemap.md) enumerating every page, API route, and UI walk path with concrete selectors, actions, and expected status-line copy, executable as a spec, plus an agent-judged qualitative audit (surface parity, module reachability, quality-signal sensitivity, copy judgment) for gaps string assertions can't see. Use when asked to E2E-test the app, validate the full client surface, smoke-test before a release, review a change for experience gaps, or check which routes/flows a change touches.
---

# Agent-driven E2E testing

Validate the whole agent.branch client surface by stepping through
**`sitemap.md`** (in this folder) — a machine-followable spec: every node the
app exposes, and ordered walk paths whose steps each carry a `selector`, an
`action`, and an `expect`. Run all walks for a full validation pass, or only
the walks whose routes a change touches. **`walk-runner.mjs`** (same folder)
is the executable form of the spec — `node .agents/skills/e2e-sitemap/walk-runner.mjs`
from the repo root prints a per-walk PASS/FAIL matrix and exits non-zero on
any failure.

Prerequisite: a healthy dev server (use the `agent-setup` skill; the `verify`
skill is the quick single-flow subset of this spec).

## Driver

Playwright over `playwright-core` with an automatically discovered browser.
Set `CHROMIUM_PATH` to explicitly override discovery:

```ts
import { chromium } from "playwright-core";
import { resolveChromiumExecutable } from "./browser-executable.mjs";
const { executablePath } = await resolveChromiumExecutable();
const browser = await chromium.launch({ executablePath });
const page = await browser.newPage();
// Accept confirms, but DISMISS the optional safety-rating offer inside
// promote — accepting it runs a model-costing safety rating, which offline
// fails and aborts the promote (sitemap §1 dialog table).
page.on("dialog", (d) =>
  d.message().startsWith("Optional: run a safety rating") ? d.dismiss() : d.accept(),
);
await page.goto("http://localhost:3000/");
```

## Protocol — how to read a walk step

1. **Status line is the synchronisation point.** The app reports every action
   outcome in `[role="status"]`. After each `action`, wait for the status text
   in `expect` (`page.getByRole("status")` + `toHaveText`/`toContainText`)
   before the next step. Never sleep-and-hope.
2. **Match nav by accessible name, not `aria-label` CSS.** The side rail is a
   collapsed icon rail whose buttons carry `aria-label`s, but it expands on
   hover into a labelled slideout and the `aria-label`s disappear — a
   `button[aria-label="Import"]` selector breaks mid-run.
   `page.getByRole("button", { name: "Import" })` works in both states. Hero
   tool chips are buttons named `Visualise` / `Run` / `Triggers` / `Safety` /
   `Export` (use `exact: true`); the quality chip is
   `button[aria-label^="Quality"]`.
3. **Confirm dialogs** guard promote, discard, and restore — the
   message-aware `page.on("dialog")` handler above is mandatory or those
   walks hang or veer off the offline path (sitemap §1 lists every dialog).
4. **State is session-scoped offline.** Memory adapters reset on server
   restart, so walks that need a saved skill depend on WALK-01 (import) having
   run in the same server session. Run walks in spec order unless a walk's
   `precondition` says it is independent. Accounts cap at five skills —
   repeated full passes against one server session eventually hit
   `You're at your skill limit…`; restart the dev server for a clean session.
5. **Offline expectations are assertions, not failures.** With no model key,
   evaluation chips must fail with `No model is configured.` and re-enable,
   and the chat authoring loops fail with `No API key for "<provider>"…`.
   That friendly degradation is part of the spec (WALK-08, WALK-10).

## Pass / fail and reporting

- A **step fails** when its `expect` does not appear within 15s (30s for the
  first page load) or an unexpected error status renders.
- A **walk fails** on its first failing step; later steps in that walk are
  `skipped` (their preconditions are unmet), and independent walks still run.
- Report per walk: `PASS` / `FAIL (step N: expected …, saw …)` / `SKIPPED`,
  plus a final matrix of walk × result. Screenshot on every failure.

## Qualitative audit — run it, don't skip it

Green walks are necessary, not sufficient: they assert exact strings, so a
merged module no user can reach, a primitive shipping second-class, or a
quality score that barely moves between clean and broken input all pass
silently. **Sitemap §3** is the audit for that class of gap — four checks
(QUAL-01 surface-parity matrix, QUAL-02 module-reachability ledger, QUAL-03
quality-signal sensitivity probes, QUAL-04 judgment screenshots), each
reporting `OK` or a named finding with evidence.

- The walk runner cannot execute §3 — it is agent-judged by design. Read the
  source files §3 names, curl the probe routes, screenshot, and judge.
- Run §3 on every full validation pass. On a change-scoped pass, run the
  audits the change can move: any new `src/modules/*` folder → QUAL-02; any
  workspace/hero/panel change → QUAL-01 + QUAL-04; any lint/analyzer or
  corpus change → QUAL-03.
- Findings are **reported, never walk failures**. Autonomously (a post-merge
  or scheduled pass): search open GitHub issues for a duplicate first, then
  file one issue per distinct finding with the audit id and evidence, and
  link it from the §3 table it belongs to.

## Keeping the spec honest

`sitemap.md` mirrors the code — nav labels in
`src/components/side-rail.tsx`, chips in `tool-chips.tsx`, status copy in
`components/workspace/workspace.ts`, routes under `src/app/`. When a walk
fails because copy or a route changed (not because of a bug), fix
`sitemap.md` in the same change and say so in the report. The
**`sitemap-sync`** skill is the maintenance path: the pre-commit
sitemap-drift nudge recommends it (non-blocking) whenever a commit touches
`src/app/` or `src/components/` without touching this folder, and it carries
the file → spec-section map for re-grounding.
