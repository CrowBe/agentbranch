<!-- Currently a statement of purpose only. As we build out, grow this: installation/cloning,
     setup, usage guides, contributing. Keep it human-facing and present-tense. -->

# SkillBuilder

A tool for **building and testing Claude Skills** — author a skill in a chat-driven loop, watch it take shape live, then validate it before you ship.

> Working name — also considering *SkillDesign*.

---

## What it is

A [Claude Skill](https://docs.anthropic.com/en/docs/agents-and-tools/agent-skills/overview) is a reusable instruction set that tells a Claude agent how to do a job — a `SKILL.md` file with a description and a workflow. Writing one is easy; knowing whether it actually *works* is not. Will the agent reach for it at the right moment? Does the workflow hold up?

SkillBuilder closes that gap. Most tools stop at editing — the durable value here is **validating a skill before it ships**.

You describe what you want in plain language. SkillBuilder writes the skill live in front of you, and lets you:

- **See it as a document** — a friendly, readable view by default; the raw `SKILL.md` source one click away.
- **Visualise its logic** — a diagram of what the skill actually does.
- **Test-run it** — watch the skill run against *mocked* tools (e.g. a fake inbox) to see its behaviour. Nothing real is ever touched.
- **Check its triggering** — does it fire on the prompts it should, and stay quiet on the ones it shouldn't?
- **Export it** — download an installable Claude skill, ready to use.

## Who it's for

Two kinds of people, one tool:

- **Builders** fluent in `SKILL.md`, YAML, and trigger logic who want a credible pro-tool.
- **Small-business owners** automating their admin (inbox, scheduling, docs) with AI, who shouldn't have to read a line of YAML to get there.

The design goal is **approachable without dumbing it down** — technical depth is there when you want it, out of the way when you don't.

## How it works

SkillBuilder is Claude-ecosystem-first. You build with Claude; the tool runs the model on its own key and meters usage, so there's nothing to configure.

Support for other AI tools (ChatGPT, Gemini, Grok) comes as **honest portability** — *"will your skill survive over there?"* — not a false "runs everywhere" promise. A skill is a Claude-native thing, and SkillBuilder is straight with you about what carries over.

## Documentation

| Doc | What's in it |
|-----|--------------|
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | What we build and why — product, system, data, app layout. The source of truth, with a domain glossary. |
| [`docs/DESIGN.md`](docs/DESIGN.md) | The visual design system — themes, type, color, spacing, components. |

---

*Building Claude Skills you can trust.*
