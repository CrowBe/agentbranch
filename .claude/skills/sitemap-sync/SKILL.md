---
name: sitemap-sync
description: Validate and update the e2e-sitemap spec after a UI change — re-ground the sitemap's selectors, status copy, routes, and walks against the current source and prove the result with the walk runner. Use when the pre-commit sitemap-drift nudge fires, when anything under src/components or src/app changed, or when asked whether the sitemap is still accurate.
---

# Sitemap sync — validate & update the E2E spec

The e2e-sitemap spec (`.claude/skills/e2e-sitemap/`) asserts **exact** copy
strings, selectors, and routes. Any UI change can silently invalidate it. This
skill re-grounds the spec against source and proves the result by running the
walks. The pre-commit hook fires a **non-blocking nudge** when a commit
touches `src/app/` or `src/components/` without touching
`.claude/skills/e2e-sitemap/` — the nudge is a *maybe*, this skill is the
check that decides.

## 1. Find what changed

```bash
git diff --name-only origin/main...HEAD -- src/app src/components
git diff --name-only HEAD -- src/app src/components   # uncommitted work too
```

No hits → report "no UI change; sitemap untouched" and stop.

## 2. Map changed files to spec sections

Ground-truth map — each source file feeds specific parts of `sitemap.md` and
`walk-runner.mjs`:

| Changed file | Spec surface it grounds |
|---|---|
| `src/components/side-rail.tsx` | nav table (§1) — accessible names, the hover-expansion caveat |
| `src/components/tool-chips.tsx` | hero chip table (§1), chip clicks in WALK-03…08 |
| `src/components/workspace/workspace.ts` | **every status-line string** in every walk, dialog messages, equipment routing rules |
| `src/components/interaction-panel.tsx` | panel titles, placeholders, button labels (`Import skill`, `Send`, `Search`, `Build skill`) |
| `src/components/draft-controls.tsx` | draft banner copy + buttons in WALK-06/07 |
| `src/components/hero-panel.tsx` | quality chip selector, hero heading assertions |
| `src/components/app-shell.tsx` | the `[role="status"]` status line — the whole sync protocol |
| `src/components/model-console.tsx` | WALK-12 |
| `src/app/api/**/route.ts` | API surface table (§1), WALK-14 probes, request shapes |
| `src/app/**/page.tsx` | pages table (§1), WALK-13 |
| `src/app/api/_shared/*.ts` | request/response shapes in the API table |

For each hit, re-read the file and diff its labels/copy/routes against what
the spec asserts. Added surfaces (a new nav entry, chip, route, dialog) need
new spec rows/steps; removed ones get deleted — the spec reads as **current
state, no history** (CLAUDE.md doc rule).

## 3. Update the spec

Edit in `.claude/skills/e2e-sitemap/`:

- `sitemap.md` — tables and walk steps (exact strings, selectors, routes).
- `walk-runner.mjs` — keep it the executable mirror of the walks it covers.
- `SKILL.md` — only if the *protocol* changed (status-line mechanism, dialog
  policy, selector rules).

## 4. Prove it

A spec update isn't done until the runner is green against a **fresh** dev
server (memory adapters must be empty — five-skill free-tier cap):

```bash
npm run db:generate   # fresh clone only
npm run dev &         # wait for curl 200 on http://localhost:3000/
node .claude/skills/e2e-sitemap/walk-runner.mjs
```

All walks must PASS. A failure means either the spec update missed something
(fix the spec) or the UI change broke a real flow (report it as a bug — do
not paper over it by weakening the assertion).

## 5. Report

State one of, with evidence:

- **No drift** — UI changed but nothing the spec asserts moved (say which
  files you re-checked).
- **Spec updated** — list each drifted assertion (old → new) and the green
  runner output.
- **Real regression** — the UI change broke a flow the spec guards; name the
  walk, the step, and the failing behaviour instead of updating the spec.
