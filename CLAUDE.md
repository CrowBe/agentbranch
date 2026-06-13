# SkillSmith — agent guide

Tool for building + testing agent skills (the Agent Skills open standard). Author a skill in a chat-driven loop, see it live, validate it (visualise / test-run / triggering eval), export it. Claude-first runtime, standard-native artifact.

## Source of truth

Read before working — don't re-derive from this file:

- **`docs/ARCHITECTURE.md`** — what we build and why (product, system, data, app layout). **§2 is the domain glossary — use those terms exactly.**
- **`docs/DESIGN.md`** — visual design system (themes, type, color, spacing, components).

If layout and theme disagree, ARCHITECTURE wins. DESIGN dresses the shell; it doesn't redefine it.

## Domain language (from the glossary — non-negotiable)

- **Skill** — instruction-only `SKILL.md` (frontmatter + body) per the Agent Skills open standard. No runnable code. Claude is the first-class runtime; the artifact installs across compatible tools.
- **Build loop** — the core agentic loop (Claude via Vercel AI SDK; `write_skill`/`edit_skill`, streams to preview).
- **Skill-analysis seam** — the spine: read skill → emit structured artifact → render. New capability? Ask "what renderer is this?" before "what service?".
- **Skill IR** — visualise's artifact (nodes+edges+source-spans). One thing on the seam, *not* the seam itself.
- **Test run** — running a skill against mocked tools (mechanism: **mock-tool registry**; tool: `execute_skill`). **Never write "sandbox"** — it intimidates both audiences. Always "test run" in user-facing copy.
- **Triggering eval** — does the skill fire on the right prompts, stay silent on the wrong ones.
- **Cross-runtime validation** — the portability surface: one engine runs the skill's triggering battery against other runtimes' models (provider swap through the gateway). Skills travel as-is under the open standard — behaviour, not format, is the portability question; no per-target export packages.
- **Rendered / Source view** — the hero's two views: Rendered (friendly doc, default) + Source (raw mono `SKILL.md`).

Note: SkillSmith authors / validates / exports skills — it does **not *deploy*** them (no schedules, webhooks, production runs). "Run" means a test run, not a deploy.

## How docs work here (greenfield, in active flux)

- **Docs read as current state — no history.** No decision-log tables, no "retired / rejected / was-X-now-Y" asides, no ADR register. State what a thing *is* and *why* (live rationale stays); strip how-we-got-here.
- Suggest a decision register **only** when a decision is actually being reversed and the old reasoning needs preserving.
- Keep UI/layout/system/data decisions in ARCHITECTURE (all the same *kind* of knowledge). DESIGN is only for the visual system.
- **Update existing docs instead of adding new files** — drift stays contained when knowledge has one home. A new doc needs the same justification as a decision register: the content genuinely fits nowhere that exists.

## Audience & tone

Bridge audience: technical builders **and** non-technical SMB owners. Identity is **warm-pro** — one approachable-but-credible system, not a fork. UI copy is sentence-case, plain language. **Terms must clear the least-technical user**, not the most — avoid jargon (sandbox, harness, registry, interceptor) in anything user-facing.

## Stack

Next.js 16 (App Router) + TypeScript · **Postgres via Prisma 7** (driver-adapter `@prisma/adapter-pg`; config in `prisma.config.ts`) · **Clerk** auth (Google+GitHub) · **Vercel AI SDK** (`ai` + `@ai-sdk/anthropic` / `@ai-sdk/openai-compatible`, default Claude models with optional Nous Portal) · SSE streaming · **Tailwind v4** (design tokens as CSS vars in `src/app/globals.css`) · Vitest. The build loop streams from `src/app/api/build/route.ts`, reaching the model through the **model gateway** — which owns the provider key and never touches the client.

Package manager is **pnpm**. The app boots without any secrets: missing `DATABASE_URL` / Clerk keys / selected model-provider key degrade to in-memory + stub adapters (see `src/server/container.ts`), so the shell runs offline.

## Commands

- `pnpm dev` — run the app · `pnpm build` · `pnpm start`
- `pnpm test` (Vitest, run once) · `pnpm test:watch`
- `pnpm typecheck` (tsc) · `pnpm lint` (eslint)
- `pnpm db:generate` · `pnpm db:push` · `pnpm db:migrate` (Prisma; needs `DATABASE_URL`)

Copy `.env.example` → `.env.local` and fill in to switch from stubs to real services. For Nous Portal, set `SKILLBUILDER_MODEL_PROVIDER=nous`, `NOUS_API_KEY`, and a Nous model such as `Hermes-4.3-36B`.

## Architecture map (DDD / deep modules)

Hexagonal: pure **domain modules** depend on ports (interfaces); **infra** supplies adapters; a **composition root** wires them. Cross-module imports go through each module's `index.ts` barrel only — never deep paths.

- `src/shared/` — kernel: `Result`, branded ids, `DomainError`, SSE envelope.
- `src/modules/<domain>/` — the domain. Each is a deep module with an `index.ts` public surface + co-located tests:
  - `skill` (the aggregate + lossless `SKILL.md` parse/serialize), `skill-analysis` (**the seam** — two shapes: **analysis** `defineCapability`/`runCapability` (static, offline) and **evaluation** `defineEvaluation`/`runEvaluation` (dynamic, needs the model gateway)), `hero` (Rendered+Source renderers), `visualise` (skill IR → Mermaid), `test-run` (mock-tool registry + `execute_skill`), `triggering-eval`, `export` (standard skill-folder `.zip` manifest), `portability` (stub engine — cross-runtime validation), `build-loop` (tools + event mapping; streams through the gateway's `streamAgent`, no raw model access), `model-gateway` (**the platform's single metered entry to the model** — `classify`/`runAgent`/`streamAgent`/`generate` primitives + `account`/`platform` accounting tag; owns the `ModelProvider` port; depends on `usage`), `usage` (tier caps + accounting authority), `auth` (`AuthPort`).
- `src/infra/` — adapters: `prisma/`, `memory/` (offline default), `ai/` (Anthropic/Nous providers + **model-gateway** adapter, each with an offline stub), `clerk/` (real + stub auth).
- `src/server/` — `config.ts` (env→flags), `container.ts` (composition root), `build-stream.ts` (loop→SSE).
- `src/app/` — App Router presentation; `src/components/` — the shell (top bar, rail, hero, panel) dressed per `DESIGN.md`.

New capability? It's almost always a **renderer on the skill-analysis seam** (`defineCapability`), not a new pipeline. New external service? A **port in the domain module + adapter in infra**, wired in `container.ts`.

Most logic is real where it's pure and load-bearing (SKILL.md, the seam, usage caps, hero/visualise/export renderers). The **build loop** is real and runs through the gateway's `streamAgent` (gated + accounted under the `build` capability). The two **evaluation capabilities** are real `Evaluator`s on the seam (`triggeringEvalCapability`, `testRunCapability`) — each composes the model gateway's primitives (`classify`/`runAgent` for the run, `generate` for the **Insight**) and emits an `Artifact<kind>` carrying that Insight; each exposes two renderers, `insights` (default, friendly — the model-written interpretation) and `breakdown` (raw cases/transcript). Their *inputs* (prompt battery, scenario, mock-tool inference) are still keyword/default **stubs** marked `STUB` in-file. **Future work:** the gateway's remaining consumers — cross-runtime validation and mock-data generation — don't route through it yet; streaming token accounting in `streamAgent` is best-effort (read once after the stream settles); IR extraction and cross-runtime validation stay stubbed behind their real interfaces.

## Keep this file accurate

**As we build, keep this matching reality** — update commands, entrypoints, and which modules are still stubbed vs. real. The README is present-tense product framing on purpose; this file must stay honest about repo state.
