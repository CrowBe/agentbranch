# agent.branch — agent guide

Tool for building + testing the **harness layer** of an agentic system — skills, tool and MCP surfaces, subagent definitions, loops, compaction and context strategy, policies, model settings. Skills are the entry rung and where the product is sharpest: author one in a chat-driven loop, see it live, validate it, export it. Provider-routed runtime, standard-native artifact.

## Read before working

These are the source of truth — don't re-derive their contents here.

- **`VISION.md`** — the durable statement of what agent.branch is for and what it deliberately is not. Read it when a scoping question is really a product-identity question; it is the tiebreaker. `VISION-ANSWERS.md` records the reasoning behind it — the stress-test hypotheticals and their verdicts — so check there before re-litigating a settled question.
- **`docs/ARCHITECTURE.md`** — what we build and why (product, system, data, app layout). **§2 is the domain glossary.**
- **`docs/MODULE_DESIGN.md`** — the module map, dependency rules, the skill-analysis seam, and commands/runtime facts (§7).
- **`docs/DESIGN.md`** — the visual design system, plus audience & tone (§1).
- **`GLOSSARY.md`** — the domain-language contract (one term per concept, with aliases to avoid).

If ARCHITECTURE and DESIGN disagree, ARCHITECTURE wins. **Domain language is non-negotiable — use the glossary terms exactly** (notably: "test run", never "sandbox").

## Recurring decisions

**Docs read as current state — no history.** No decision-log tables, no "retired / was-X-now-Y" asides, no ADR register. State what a thing *is* and *why* (live rationale stays); strip how-we-got-here. Add a decision register only when a decision is actually being reversed and the old reasoning must be preserved.

**Knowledge has one home — update existing docs, don't add files.** A new doc needs the same justification as a decision register: the content genuinely fits nowhere that exists. Keep UI/layout/system/data decisions in ARCHITECTURE; DESIGN is only the visual system.

**Instruction files: this file is the source of truth.** `CLAUDE.md` is a symlink to it. Keep it small — point to the docs above and record decisions that live nowhere else. Don't restate anything discoverable (stack, commands, module layout) that a doc or `package.json` already carries; point to it instead.

**Agent extensions use the open layout.** Keep reusable skills under `.agents/skills/`. `.claude/skills` is a compatibility symlink only; do not put source files there.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
