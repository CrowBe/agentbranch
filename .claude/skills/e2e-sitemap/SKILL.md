---
name: e2e-sitemap
description: Agent-driven end-to-end validation of agent.branch — a bot-friendly sitemap (sitemap.md) enumerating every page, API route, and UI walk path with concrete selectors, actions, and expected status-line copy, executable as a spec. Use when asked to E2E-test the app, validate the full client surface, smoke-test before a release, or check which routes/flows a change touches.
---

# Agent-driven E2E testing

Validate the whole agent.branch client surface by stepping through
**`sitemap.md`** (in this folder) — a machine-followable spec: every node the
app exposes, and ordered walk paths whose steps each carry a `selector`, an
`action`, and an `expect`. Run all walks for a full validation pass, or only
the walks whose routes a change touches. **`walk-runner.mjs`** (same folder)
is the executable form of the spec — `node .claude/skills/e2e-sitemap/walk-runner.mjs`
from the repo root prints a per-walk PASS/FAIL matrix and exits non-zero on
any failure.

Prerequisite: a healthy dev server (use the `agent-setup` skill; the `verify`
skill is the quick single-flow subset of this spec).

## Driver

Playwright over `playwright-core` with the pre-installed browser:

```ts
import { chromium } from "playwright-core";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
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
   `precondition` says it is independent. The free tier caps skills at five —
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

## Keeping the spec honest

`sitemap.md` mirrors the code — nav labels in
`src/components/side-rail.tsx`, chips in `tool-chips.tsx`, status copy in
`components/workspace/workspace.ts`, routes under `src/app/`. When a walk
fails because copy or a route changed (not because of a bug), fix
`sitemap.md` in the same change and say so in the report.
