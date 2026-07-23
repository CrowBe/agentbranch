---
name: agent-setup
description: Agent-driven setup of agent.branch from a fresh clone — install, generate the Prisma client, verify the gates, boot the dev server offline, and optionally wire real services. Use when setting up this repo, preparing a session to run the app or its tests, or diagnosing a boot/typecheck failure on a fresh checkout.
---

# Agent-driven setup

Bring a fresh clone of agent.branch to a verified, running state without any
human input. The app is designed for this: **it boots with zero secrets** —
missing `DATABASE_URL` / Clerk keys / model-provider keys degrade to memory +
stub adapters (`src/server/container.ts`), so every step below works offline.

## 1. Install and generate

```bash
npm ci                  # lockfile install (falls back: npm install)
npm run db:generate     # REQUIRED once per fresh clone — typecheck and boot
                        # both need the generated Prisma client
```

Skipping `db:generate` is the #1 fresh-clone failure: `tsc` and `next dev`
fail on the missing `@prisma/client` types. No `DATABASE_URL` is needed to
generate.

## 2. Verify the gates

Run all four; each must exit 0 on a clean clone:

```bash
npm run typecheck       # tsc --noEmit
npm run lint            # eslint
npm test                # vitest, single run
npm run check:docs      # doc-drift guard (modules ↔ MODULE_DESIGN §4)
```

`npm run test:visual` (browser-mode screenshot suite) needs Chrome or Chromium.
The E2E walk runner discovers Playwright-cache and common system installations;
set `CHROMIUM_PATH=/path/to/chrome` to override discovery. Never run
`playwright install`.

## 3. Boot and health-check

```bash
npm run dev             # Next dev server on http://localhost:3000
```

Poll until healthy (first compile takes ~10s):

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/   # expect 200
```

Offline posture to expect once booted:

- Persistence = in-memory (skills reset on every server restart).
- Auth = stub identity (no sign-in wall).
- Model calls fail with the friendly `No model is configured.` message —
  analysis capabilities (hero, lint, visualise fallback, export) still work;
  evaluation capabilities (test run, triggering eval, safety review) answer
  503 / `model_unavailable`, which is correct behaviour worth asserting, not
  a setup failure.

## 4. Optional: wire real services

Copy `.env.example` → `.env.local`. Each secret independently flips one
adapter (flags in `src/server/config.ts`):

| Env | Flips | Follow-up |
|---|---|---|
| `DATABASE_URL` | memory → Prisma/Postgres | `npm run db:push` (dev) or `db:migrate` |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` + `CLERK_SECRET_KEY` | stub → Clerk auth | sign-in becomes real; admin routes need the allowlist below |
| `ANTHROPIC_API_KEY` (or `NOUS_API_KEY` + `AGENTBRANCH_MODEL_PROVIDER="nous"`) | no model → model router configured | build loop + evaluations go live and spend tokens |
| `AGENTBRANCH_ADMIN_USER_IDS` / `AGENTBRANCH_ADMIN_EMAILS` | locks/unlocks the model console + admin routes when auth is on | empty list with auth on = locked (fail-safe) |
| `CRON_SECRET` | unlocks `/api/cron/retention` | unset = route locked (fail-safe) |

Restart the dev server after env changes — the container is cached per
process.

## 5. Done criteria

Setup is complete when: all four gates pass, `GET /` returns 200, and the
offline degradations above behave as described. To then verify a change in
the running UI, use the `verify` skill (quick recipe) or the `e2e-sitemap`
skill (full walk spec).
