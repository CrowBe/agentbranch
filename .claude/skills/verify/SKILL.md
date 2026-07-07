---
name: verify
description: Build/launch/drive recipe for verifying agent.branch changes end-to-end in the running app.
---

# Verifying agent.branch changes in the running app

The app boots offline to memory + stub adapters (no secrets needed), so the
whole client surface is drivable locally.

## Launch

```bash
npm run db:generate     # once per fresh clone (typecheck + boot need the client)
npm run dev             # Next dev server on http://localhost:3000
```

Wait for a `200` from `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/`
(first compile takes ~10s).

## Drive (Playwright, Chromium at /opt/pw-browsers/chromium in CCR)

`playwright-core` + `executablePath: "/opt/pw-browsers/chromium"`. The status
line is `[role="status"]`; wait on its text between actions. Confirm dialogs
(promote / discard / restore) need a `page.on("dialog", d => d.accept())`
handler.

Flows that exercise most of the client workspace offline:

1. **Import** (side-rail → Import): paste a `SKILL.md` → status `Import complete.`,
   hero re-renders with the new title. Garbage input → friendly lint-style error.
2. **Quality** chip (`button[aria-label^="Quality"]`) → `Quality ready.`;
   Insights/Breakdown tabs both render (lint is pure, zero tokens).
3. **My skills** → `Open` → `Skill opened.`, draft controls appear.
4. **Draft flow**: Start a draft → banner `Editing a draft`; Set as main
   version (confirm) → `This draft is now your main version.`
5. **History** → `History loaded.` with revision + run entries.
6. **Offline evaluation probe**: Triggers chip → `No model is configured.`
   and the chip re-enables (busy cleared).
7. **Equipment probe**: non-JSON input → `Equipment must be a JSON document.`

## Gotchas

- Build loop / test run / triggering eval need a model key — offline they must
  fail with the friendly message above, which is itself worth asserting.
- Memory adapters reset on server restart; import a skill first in each session.
