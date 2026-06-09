<!-- Currently a statement of purpose only. As we build out, grow this: installation/cloning,
     setup, usage guides, contributing. Keep it human-facing and present-tense. -->

# SkillSmith

**Craft agent skills you can trust** — author a skill in a chat-driven loop, watch it take shape live, then prove it works before you ship.

> Working name (previously *SkillBuilder*) — the repository name will follow.

---

## What it is

An [agent skill](https://agentskills.io) is a reusable instruction set that tells an AI agent how to do a job — a `SKILL.md` file with a description and a workflow. It's an open standard: the same skill installs in Claude, Codex, Gemini CLI, Copilot and a growing list of tools. Writing one is easy; knowing whether it actually *works* is not. Will the agent reach for it at the right moment? Does the workflow hold up?

SkillSmith closes that gap. Most tools stop at editing — here a skill leaves the bench **proven, not just written**. Describe what you want in plain language; SkillSmith writes the skill live in front of you, and lets you:

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

Because the format already travels, portability is about *behaviour*: **honest validation** — *"will your skill survive over there?"* — checking how the skill triggers and behaves on other tools' models, not a false "works identically everywhere" promise. SkillSmith is straight with you about what carries over.

## Documentation

| Doc | What's in it |
|-----|--------------|
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | What we build and why — product, system, data, app layout. The source of truth, with a domain glossary. |
| [`docs/DESIGN.md`](docs/DESIGN.md) | The visual design system — themes, type, color, spacing, components. |

---

*Agent skills, crafted and proven.*
