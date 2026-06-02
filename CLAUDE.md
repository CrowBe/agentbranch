# SkillBuilder — agent guide

Tool for building + testing Claude Skills. Author a skill in a chat-driven loop, see it live, validate it (visualise / test-run / triggering eval), export it. Claude-ecosystem-first.

## Source of truth

Read before working — don't re-derive from this file:

- **`docs/ARCHITECTURE.md`** — what we build and why (product, system, data, app layout). **§2 is the domain glossary — use those terms exactly.**
- **`docs/DESIGN.md`** — visual design system (themes, type, color, spacing, components).

If layout and theme disagree, ARCHITECTURE wins. DESIGN dresses the shell; it doesn't redefine it.

## Domain language (from the glossary — non-negotiable)

- **Skill** — instruction-only `SKILL.md` (frontmatter + body). No runnable code.
- **Build loop** — the core agentic loop (Claude via Vercel AI SDK; `write_skill`/`edit_skill`, streams to preview).
- **Skill-analysis seam** — the spine: read skill → emit structured artifact → render. New capability? Ask "what renderer is this?" before "what service?".
- **Skill IR** — visualise's artifact (nodes+edges+source-spans). One thing on the seam, *not* the seam itself.
- **Test run** — running a skill against mocked tools (mechanism: **mock-tool registry**; tool: `execute_skill`). **Never write "sandbox"** — it intimidates both audiences. Always "test run" in user-facing copy.
- **Triggering eval** — does the skill fire on the right prompts, stay silent on the wrong ones.
- **Portability transform** — one engine, two surfaces (cross-provider validation + cross-primitive export).
- **Rendered / Source view** — the hero's two views: Rendered (friendly doc, default) + Source (raw mono `SKILL.md`).

Note: SkillBuilder authors / validates / exports skills — it does **not *deploy*** them (no schedules, webhooks, production runs). "Run" means a test run, not a deploy.

## How docs work here (greenfield, in active flux)

- **Docs read as current state — no history.** No decision-log tables, no "retired / rejected / was-X-now-Y" asides, no ADR register. State what a thing *is* and *why* (live rationale stays); strip how-we-got-here.
- Suggest a decision register **only** when a decision is actually being reversed and the old reasoning needs preserving.
- Keep UI/layout/system/data decisions in ARCHITECTURE (all the same *kind* of knowledge). DESIGN is only for the visual system.

## Audience & tone

Bridge audience: technical builders **and** non-technical SMB owners. Identity is **warm-pro** — one approachable-but-credible system, not a fork. UI copy is sentence-case, plain language. **Terms must clear the least-technical user**, not the most — avoid jargon (sandbox, harness, registry, interceptor) in anything user-facing.

## Stack (planned)

Next.js (App Router) + TypeScript · Postgres (Prisma/Drizzle) · Clerk auth (Google+GitHub) · Vercel AI SDK · SSE streaming · Vercel + Neon/Supabase. The build loop lives in a route handler that owns the Anthropic key — it never touches the client.

## Keep this file accurate

This file's framing assumes the repo is pre-implementation. **As we scaffold and build, update it to match reality** — drop "(planned)", add real run/test/build commands and setup steps, point at actual entrypoints. The README is present-tense product framing on purpose; this file must stay honest about repo state so an agent doesn't run commands that don't exist yet.
