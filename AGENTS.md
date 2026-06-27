# agent.branch — agent guide

Tool for building + testing agent skills (the Agent Skills open standard): author a skill in a chat-driven loop, see it live, validate it, export it. Claude-first runtime, standard-native artifact.

## Read before working

These are the source of truth — don't re-derive their contents here.

- **`docs/ARCHITECTURE.md`** — what we build and why (product, system, data, app layout). **§2 is the domain glossary.**
- **`docs/MODULE_DESIGN.md`** — the module map, dependency rules, the skill-analysis seam, and commands/runtime facts (§7).
- **`docs/DESIGN.md`** — the visual design system, plus audience & tone (§1).
- **`CONTEXT.md`** — the domain-language contract (one term per concept, with aliases to avoid).

If ARCHITECTURE and DESIGN disagree, ARCHITECTURE wins. **Domain language is non-negotiable — use the glossary terms exactly** (notably: "test run", never "sandbox").

## Recurring decisions

**Docs read as current state — no history.** No decision-log tables, no "retired / was-X-now-Y" asides, no ADR register. State what a thing *is* and *why* (live rationale stays); strip how-we-got-here. Add a decision register only when a decision is actually being reversed and the old reasoning must be preserved.

**Knowledge has one home — update existing docs, don't add files.** A new doc needs the same justification as a decision register: the content genuinely fits nowhere that exists. Keep UI/layout/system/data decisions in ARCHITECTURE; DESIGN is only the visual system.

**Instruction files: this file is the source of truth.** `CLAUDE.md` is a symlink to it. Keep it small — point to the docs above and record decisions that live nowhere else. Don't restate anything discoverable (stack, commands, module layout) that a doc or `package.json` already carries; point to it instead.
