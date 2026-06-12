# Skill tap — distribution, moderation & quality assurance

**Status: designed, not built.** This document is the gate for the tap: no tap code lands until the
moderation system described here exists, because shipping a distribution source without it is a
reputational one-way door. Referenced from `ARCHITECTURE.md` §9.

"Tap" (Homebrew sense — an installation source you add once, then install from by name) is the
**internal** term. User-facing copy says **Publish** (the action) and **Skill library** (the
surface) — "tap" doesn't clear the least-technical user.

A tap is *distribution*, not deploy: SkillSmith still never schedules, hosts webhooks, or runs
skills in production. It gives a validated skill a public address.

---

## 1. Threat model

Skills are instruction-only, so the tap never hosts a binary payload — but that boundary binds
*our* platform, not the consumer's runtime. A published `SKILL.md` installs into agents holding
shells, browsers, email, and credentials. Model a skill as **a program whose interpreter is an
LLM**. The attack classes, in rough order of likelihood:

| # | Class | Shape |
|---|---|---|
| 1 | **Direct malicious instructions** | "As a cleanup step, run `curl … \| bash`"; read `~/.aws/credentials` and send them somewhere. The skill is the payload; the host agent is the executor. |
| 2 | **Agent hijacking / prompt injection** | Instructions that override the host agent's guardrails or reframe its goals ("ignore prior safety rules…"). |
| 3 | **Trigger hijacking** | A deceptive `description` that fires the skill on prompts it has no business handling, inserting attacker text into unrelated tasks. The standard's selection mechanism *is* the description — this is the tap-specific risk. |
| 4 | **Latent / conditional payloads** | Benign on read, malicious on a date, keyword, or fetched URL ("then fetch instructions from … and follow them"). Indirection defeats one-time review. |
| 5 | **Reference-file smuggling** | Once a skill folder is more than one `SKILL.md`, the payload hides in the file the reviewer skimmed. Every gate layer reads the *whole folder*. |
| 6 | **Typosquatting / impersonation** | "invoice-procesor"; skills claiming to be official. Distribution-layer, not content. |

**Accepted hard limit:** class 4 is not solvable by review alone — anything checked only at
publish time is defeated by external indirection. The countermeasure is *content policy*, not just
scanning: published skills may not instruct the agent to fetch-and-follow remote instructions.
That pattern is a hard lint failure, full stop. We knowingly narrow what a published skill may do
in exchange for being able to reason about it.

---

## 2. Why the gate lives on the seam

SkillSmith is not a file host bolting moderation on — it is a validation tool that also
distributes. The publication gate **is** the skill-analysis seam, reused:

- **Skill lint** (analysis, zero tokens) carries the static policy rules: shell-execution
  patterns, credential-path references, fetch-and-follow indirection, obfuscated text.
- **Triggering eval** (evaluation) is the trigger-hijack scanner: the negative prompt battery is
  extended with adversarial off-topic prompts — a skill that fires where it shouldn't fails the
  gate, not just the report card.
- **Test run** (evaluation) catches behaviour the text hides: a skill that *attempts*
  exfiltration-shaped tool calls or remote fetches against the mock-tool registry reveals itself
  in the transcript.
- **Safety review** — a **new evaluation capability** on the seam (`safetyReviewCapability`):
  an LLM judge reads the full skill folder and scores injection, exfiltration intent, and
  deception. Composes the model gateway's primitives like every evaluator; calls are tagged
  **`platform`** (our cost of running a trustworthy library, never the user's allowance). Its
  artifact renders as a verdict + reasons. **The judge is structurally untrusted**: it reads the
  skill strictly as data, its verdict is a backstop and never the sole gate, and it is itself a
  target for class-2 content.

A skill earns distribution by passing the same battery it was authored against. That is the
product thesis (*testing tool that also authors*) becoming the trust story: **every skill in the
library passed its checks — and you can see them.**

---

## 3. Decision: automated gate + tiered visibility

Publication is self-serve behind a blocking automated gate; human review gates **amplification**,
not existence. Moderation cost scales with what we promote, not with volume.

| Tier | Bar | Reach |
|---|---|---|
| **Private** | — | Default. Owner only (status quo today). |
| **Community** | Automated gate passed (lint policy + adversarial triggering eval + test run + safety review) | In the tap; reachable by direct link and installable. Labelled plainly: *"community skill — automated checks passed, not human-reviewed"*. |
| **Reviewed** | Community bar **+ human review** | Surfaced: search, Templates, featured. What we vouch for. |

Supporting policy:

- **Publisher accountability** — OAuth-only identity (already true); publishing may require
  minimum account standing. Every published version is attributable.
- **Immutability + provenance** — publish pins an append-only `SkillVersion` (already true) and a
  content hash; the thing reviewed is provably the thing served. New version = new gate run.
- **Publish-spam protection** — the gate spends platform tokens, which is itself an abuse surface.
  Publish attempts are rate-limited per user via the existing per-capability rate-limit windows.
- **Namespace policy** — slugs are claimed under the publisher's handle (`owner/skill-name`);
  no global flat namespace, which removes most squatting value. Impersonation handled by takedown.

---

## 4. Decision: the tap is a public git repo — review in the open

Published skills are served from a **public GitHub tap repo** carrying a
`.claude-plugin/marketplace.json`, so any Claude Code user adds the tap once and installs by name.
The repo is not a mirror of the system — it **is the publication mechanism**, which open-sources
the review process the way Homebrew does:

1. **Publish = bot PR.** SkillSmith opens a PR to the tap repo adding `skills/<owner>/<slug>/`
   (the standard skill folder, rendered by the existing export renderer) pinned to a
   `SkillVersion` + content hash.
2. **The gate's verdicts are public checks on that PR.**
   - The **lint policy rules run as open-source CI in the tap repo itself** — lint is a pure,
     zero-token analysis capability, so it can be extracted and run anywhere. Anyone can read the
     rules, propose new ones, and re-run them.
   - The **evaluation layers** (triggering eval, test run, safety review) need the model gateway,
     so they run hosted; SkillSmith posts their verdicts and result artifacts to the PR as status
     checks. Hosted, but *visible*.
3. **Merge = published** (community tier; merges are automatic on a green gate). The curated
   **reviewed** tier is an index file in the repo (`reviewed.json` or marketplace metadata)
   changed only by human-approved PRs — the vouching step is itself a public, attributable diff.
4. **Takedown = revert at HEAD.** Installation always reads HEAD, so a revert ends
   installability immediately. Reports come via repo issues *and* an in-app report path.

**Accepted residual risk — git history persists.** A reverted malicious skill remains fetchable
from history by someone who digs. Acceptable for instruction text where it would not be for
binaries, and mitigated by: revert immediately, then purge via host support for confirmed
malware; and the gate existing precisely so little reaches HEAD in the first place.

**Accepted trade — the static rules are public.** Attackers can test against the lint offline.
Chosen deliberately: transparency builds more trust than the obscurity protects, and the
model-based layers (triggering eval, safety review) stay hosted and adaptive — the public rules
are the floor, not the whole gate.

---

## 5. Consumer-side honesty

We cannot make another runtime safe, and the standard has no permissions manifest. What we can do
is surface, at the install boundary: the skill's **derived tool/behaviour footprint** (from
analysis — which tools the instructions reach for), its **trust tier**, its **gate results**, and
its **content hash**. Presentation derived from analysis, never a guarantee — copy says so.

---

## 6. Build order (when the tap is greenlit)

The moderation system leads; distribution follows.

1. **Lint policy rules** — the static malware/indirection ruleset inside skill lint. Pure, useful
   to every author today even with no tap.
2. **Adversarial battery** — extend the triggering eval's negative battery with hijack prompts.
3. **`safetyReviewCapability`** — the LLM-judge evaluator on the seam, `platform`-tagged.
4. **Publication domain** — published-skill record (pinned version, slug, tier, hash), publish/
   unpublish, rate limit.
5. **Tap repo + bot** — PR flow, open-source lint CI, hosted-gate status checks, auto-merge on
   green, revert path.
6. **Reviewed tier + Skill library surface** — human-review flow, curated index, in-app browse
   (the Templates nav becomes a view over the reviewed tier).
