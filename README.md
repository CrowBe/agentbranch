<!-- Human-facing and present-tense. Purpose, then how to run it locally and
     prove it end-to-end. Deeper rationale lives in docs/ — link, don't restate. -->

# agent.branch

**Craft agent skills you can trust** — author a skill in a chat-driven loop, watch it take shape live, then prove it works before you ship.

---

## What it is

An [agent skill](https://agentskills.io) is a reusable instruction set that tells an AI agent how to do a job — a `SKILL.md` file with a description and a workflow. It's an open standard: the same skill installs in Claude, Codex, Gemini CLI, Copilot and a growing list of tools. Writing one is easy; knowing whether it actually *works* is not. Will the agent reach for it at the right moment? Does the workflow hold up?

agent.branch closes that gap. Most tools stop at editing — here a skill leaves the bench **proven, not just written**. Describe what you want in plain language; agent.branch writes the skill live in front of you, and lets you:

- **See it as a document** — a friendly, readable view by default; the raw `SKILL.md` source one click away.
- **Visualise its logic** — a diagram of what the skill actually does.
- **Test-run it** — watch the skill run against *mocked* tools (e.g. a fake inbox) to see its behaviour. Nothing real is ever touched.
- **Check its triggering** — does it fire on the prompts it should, and stay quiet on the ones it shouldn't?
- **Export it** — download an installable skill folder, ready to use in Claude and other compatible tools.

## Who it's for

Two kinds of people, one tool:

- **Builders** fluent in `SKILL.md`, YAML, and trigger logic who want a credible pro-tool.
- **Small-business owners** automating their admin (inbox, scheduling, docs) with AI, who shouldn't have to read a line of YAML to get there.

The design goal is **approachable without dumbing it down** — technical depth is there when you want it, out of the way when you don't.

## How it works

You build with Claude — the tool runs the model on its own key and meters usage, so there's nothing to configure. What you export is yours: a standard skill folder, not something locked to this tool or any one platform.

Because the format already travels, portability is about *behaviour*: **honest validation** — *"will your skill survive over there?"* — checking how the skill triggers and behaves on other tools' models, not a false "works identically everywhere" promise. agent.branch is straight with you about what carries over.

## Running it locally

**Prerequisites:** [Node.js](https://nodejs.org) 22+ and [pnpm](https://pnpm.io) 10 (`corepack enable` picks up the version pinned in `package.json`).

```bash
pnpm install        # install dependencies (lockfile-pinned)
pnpm db:generate    # generate the Prisma client — needed before typecheck/build
cp .env.example .env # optional: only to wire in real services (see below)
pnpm dev            # start the app at http://localhost:3000
```

**The app boots with no configuration.** Missing secrets aren't an error — each one flips the app to a stub/in-memory adapter so the whole shell runs offline (`src/server/container.ts`):

- **No database** → persistence is in-memory. Skills you create disappear on restart.
- **No auth** → a fixed dev identity is signed in for you.
- **No model key** → the four model-backed capabilities (build, visualise, test-run, triggering-eval) return `model_unavailable`. The document/source views, the skill list, and **import from a public GitHub URL** still work.

So an empty boot is enough to click around the shell — but to drive a skill *through the model*, you need at least a model provider key.

## End-to-end test (local readiness)

There is no automated browser-driven E2E suite yet (no Playwright/Cypress). "End-to-end" here means **exercising the real product flow yourself** — author → visualise → test-run → check triggering → export — against live services. This section is how to get there.

### Step 1 — confirm the build pipeline is healthy

These run with zero third-party setup and should all pass on a fresh clone:

```bash
pnpm db:generate    # Prisma client (skip if already generated)
pnpm lint           # eslint
pnpm typecheck      # tsc --noEmit
pnpm test           # vitest — unit + integration suite
pnpm build          # production build
pnpm start          # serves http://localhost:3000 (curl / → 200)
```

If those are green, the shell is ready; the only thing standing between you and a full end-to-end run is third-party setup.

### Step 2 — third-party setup

Add only what you want to exercise. **A model key is the one that unlocks the core flow;** the other two make the run faithful to production (real persistence, real auth). Put everything in `.env` (see `.env.example` for the full annotated list).

#### Model provider — *required for build / visualise / test-run / triggering-eval*

The default provider is Anthropic (Claude). Get a key from the [Anthropic Console](https://console.anthropic.com/) and set:

```bash
ANTHROPIC_API_KEY="sk-ant-..."
```

Alternatively, use the OpenAI-compatible [Nous Portal](https://portal.nousresearch.com/) — set `NOUS_API_KEY` and `SKILLBUILDER_MODEL_PROVIDER="nous"`. The server owns the key; it never reaches the browser. With auth on, the in-app **model console** (rail → Models) can switch provider/model at runtime, but env is enough for an E2E run.

#### Postgres — *optional, for persistence that survives restarts*

Any Postgres works; [Neon](https://neon.tech) and [Supabase](https://supabase.com) both have a free tier. Copy the connection string into:

```bash
DATABASE_URL="postgresql://user:password@host:5432/agent_branch?schema=public"
```

Then push the schema (creates the tables) once:

```bash
pnpm db:push
```

Without `DATABASE_URL`, skills live in memory and reset when the server restarts — fine for a quick run, but you can't prove persistence end-to-end.

#### Clerk — *optional, for real sign-in and multi-user*

Create an application in the [Clerk dashboard](https://dashboard.clerk.com/), enable the **Google** and **GitHub** social connections, and copy both keys:

```bash
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY="pk_test_..."
CLERK_SECRET_KEY="sk_test_..."
```

Both must be present for auth to switch on; with only one set, the app stays on the stub identity. When auth is on, the model console is admin-gated — list yourself in `SKILLBUILDER_ADMIN_EMAILS` (or `SKILLBUILDER_ADMIN_USER_IDS`) or it locks (fail-safe).

### Step 3 — walk the flow

With (at minimum) a model key set, `pnpm dev` and walk a skill end-to-end:

1. **Author** — describe a skill in the chat; watch it stream into the live preview, and toggle Rendered ↔ Source.
2. **Visualise** — open the diagram of the skill's logic.
3. **Test-run** — run it against mocked tools and read the Insights (nothing real is touched).
4. **Triggering** — check it fires on the right prompts and stays quiet on the wrong ones.
5. **Export** — download the installable `SKILL.md` folder.

That last download is the end-to-end proof: a standard skill folder, authored and validated on the running app.

## Documentation

| Doc | What's in it |
|-----|--------------|
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | What we build and why — product, system, data, app layout. The source of truth, with a domain glossary. |
| [`docs/MODULE_DESIGN.md`](docs/MODULE_DESIGN.md) | The module map, dependency rules, seam shape, and extension rules. |
| [`docs/DESIGN.md`](docs/DESIGN.md) | The visual design system — themes, type, color, spacing, components. |

---

*Agent skills, crafted and proven.*
