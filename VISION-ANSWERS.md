# VISION.md - stress tests and recorded answers

Calibration material for `VISION.md`. Keep it next to the vision: the verdicts here are why
the vision reads the way it does, and they are the record to check a future change against.

Produced by the `/vision` skill against 167 merged pull requests, `docs/ARCHITECTURE.md`,
`docs/DESIGN.md`, `CONTEXT.md` and `README.md`.

## Round 1 - from-scratch draft (2026-08-20)

The first draft opened with the skill as the unit of work, on the evidence of the product
thesis, the README, and the whole skill-first half of the history.

**Author response, verbatim:**

> As I thought. There's a fundamental misunderstanding. The original idea was purely focused
> on skills as a primitive. Over time I have concluded that while that can be core, given its
> ubiquity, agentbranch as a harness exists to evaluate all primitives and tooling that live
> within the harness layer of an agentic system - skills, MCPs, loops, compaction. The goal is
> an opt-in experience where you bring any set of primitives, right up to a complete harness,
> and we enable you to evaluate it. For example, if I want to know 'how good is my setup for a
> hermes agent profile focused on development', agentbranch could help me answer that. It's
> the Human In The Loop of self-improving harnesses

No hypothetical verdicts were recorded in this round; the identity itself was the correction.

### Changelog - round 1 into round 2

- Identity opener rewritten: the subject is now the harness layer of an agentic system, not a
  skill, and the owned surface is "the human-in-the-loop evaluation of a harness, so that a
  setup which improves itself never also holds the judgement of whether it improved".
- New section **The unit is the harness layer, not the skill**: names skills, tool and MCP
  surfaces, subagent definitions, loops, compaction and context strategy, policies,
  instructions and model settings as subjects; records that skills are core for ubiquity, not
  by definition; sets the question shape as "how good is this setup for this job"; makes
  everything brought and opt-in; and puts the layer below (the model, the application) out of
  scope.
- **Proof is the product** retitled to *authoring and import are the entrances*, with import
  named a first-class entrance rather than a migration convenience.
- **The evaluator sits outside the loop it judges** retitled **The human is the loop's gate**
  and given the line "the system may propose, measure, rank and explain, and a person
  accepts", so self-improvement is stated as the goal and the human as its safety property.
- Scope gained the word-collision line. This is a live conflict with `CONTEXT.md`, which
  reserves "harness" for our side only and forbids the user-side sense - carried into the
  board as H-12.
- Closing tests rewritten around assembled harnesses, a human holding the gate, and "a bigger
  subject" rather than "a bigger unit of work".

## Round 2 - hypotheticals on the board

| id | title | verdict | reasoning |
|---|---|---|---|
| H-1 | Hermes' host LLM becomes a routed provider | **In vision** | Hermes as a harness is fairly unopinionated about the underlying model provider, and agentbranch already supports Nous (the provider gateway built by the team that built Hermes), so it is less of a shift than it looks. For the plugin's simplicity it should ideally use the same inference provider as the user's current Hermes configuration. |
| H-2 | Auto-promote when the interval says the change wins | **Off mission** | The premise behind agentbranch is that the user as an approver is valuable. The product aims to surface previously opaque information and evaluation results about a harness or agent primitive and enable them to make decisions about it. |
| H-3 | Grade the model as part of the setup | **In vision** | In vision in the sense that the underlying model and inference provider is a significant variable in eval results, but not in the sense that we will offer any conclusions about the model itself. |
| H-4 | Read-only real-credential runs | **Off mission** | Off mission for now. The Hermes agent plugin is a test case for real-credential runs. Building handling of that into agentbranch is too much of an increase in scope and risk. |
| H-5 | \1| **In vision** | Make it a clear part of the platform that we use your data and results to improve the meta-harness. Clearly distinguish what we read from what we do not: configuration and evaluations, nothing private. This also supports the conclusion not to include real data integrations in the main product. |
| H-6 | \1| **Off mission** | We need this. Having a user come in, discover their config is not good, but offer no surface that facilitates iterating on it seems bad. If anything we need the ability to create and iterate on more primitives. |
| H-7 | \1| **Off mission** | The tap should offer quality tagging and gates for publish, not CI actions that run outside agentbranch. |
| H-8 | \1| **Off mission** | We need to build toward this more rapidly, not retreat from it. |
| H-9 | \1| **Off mission** | We want this. If anything, expand the tap so a user can publish a high-performing Hermes profile that another user imports directly for high value. |
| H-10 | \1| **Conditional** | Removing our temporary gap-fill work is right. The third-party evaluation of agentbranch as a harness being fully vendored makes sense. |
| H-11 | \1| **In vision** |  |
| H-12 | \1| **Conditional** | I like meta-harness, in that it captures the idea of a harness for improving harnesses. Open to being corrected. |

## Round 2 - author response on the naming conflict

**Author response, verbatim:**

> Re the conflict you raise. I think we need to either consider meta-harness (referring to our
> harness). Or qualify the harness we are referring to. E.g. user harness, agentbranch harness.

### Changelog - naming applied

- The draft adopts qualification throughout, as the option that survives either choice: every
  occurrence is now `user harness` or `agentbranch harness`, including the identity opener,
  the three-layers line, the benchmark lines and both closing tests.
- Scope now carries the convention as a rule: "Harness is always qualified, because two
  different things carry the name", followed by "An unqualified harness in docs, code, schema
  or copy is a defect, because attribution runs on both axes at once and a word that means the
  judge and the judged makes neither axis mean anything."
- H-12 was rewritten to put the remaining choice on the board: adopt `meta-harness` as a
  distinct noun for our side (In vision), or keep qualification (Off mission). Either verdict
  requires rewriting `CONTEXT.md`'s harness entry, which currently forbids the user-side sense
  the vision now depends on.

### Changelog - round 3, H-1 to H-4 folded in

- H-1 (In vision) -> **One seam, one meter** gained: "An evaluation should run on the inference
  provider the user harness itself uses wherever that provider is reachable, because a result
  produced on our substitute describes our setup rather than theirs; evidence produced by a
  host's own call is recorded as such, never mixed in silently." Provider fidelity is now a
  property of the evidence, and the metered-gateway line already scoped itself to calls the
  platform makes.
- H-2 (Off mission) -> **The human is the loop's gate** gained: "The product's work is to
  surface what was opaque about a user harness and hand the decision to a person; approval is
  the value on offer, not friction to be optimised away." This is the strongest statement of
  the identity in the document and it came from the verdict, not the evidence sheet.
- H-3 (In vision, bounded) -> the out-of-scope line was replaced: "The model is a variable of
  the setup, not a subject of it: results are reported per provider and model because that
  variable moves them, and we draw no conclusions about the model itself." The application the
  agent serves stays out of scope on its own line.
- H-4 (Off mission for now) -> the non-goal now carries its escape hatch: "...where
  real-credential behaviour matters, it is explored inside a runtime's own plugin at that
  runtime's risk, not built into this product."
- H-5 was rewritten in plain terms after the author reported it was unclear; the version on the
  board now explains what the improvement loop reads today and what the opt-in would change.

### Changelog - round 4, the remaining eight folded in

- H-5 (In vision, bounded) -> the privacy section was rewritten and retitled **What we read, and
  what we never touch**, opening "We improve the meta-harness from what users bring, and we say
  so plainly instead of burying it: configuration and evaluation records are read, and nothing
  private is." The next line makes the boundary published rather than implied and connects it
  back to H-4: material we never hold cannot leak into a corpus.
- H-6 (Off mission) -> the section is retitled **Proof is the product; bringing and building are
  both entrances** and gains "A diagnosis with no way to act on it is half a product ... so
  authoring broadens with the subject rather than narrowing - every primitive we judge is one we
  work toward letting someone create and iterate on."
- H-7 (Off mission) -> Scope gains "Evaluation happens on our surfaces, where a result can be
  pinned to a version, compared against another, and explained; a verdict rendered somewhere we
  cannot pin it is not worth having." The publish-gate half of the reasoning conflicts with
  shipped behaviour and went back to the board as H-13.
- H-8 (Off mission) -> cross-runtime is now stated as a commitment we accelerate toward rather
  than trade away, and as a central question once the subject is a whole harness rather than a
  portability footnote.
- H-9 (Off mission, expand) -> the unit section gains "Distribution scales with the subject: what
  can be evaluated should become publishable and importable, up to a whole proven profile that
  somebody else adopts instead of rebuilding." The trust consequences of publishing at
  configuration scale went back as H-14.
- H-10 (Conditional) -> no draft change yet; the uncontroversial half was already the documented
  plan, and the part about vendoring versus independence went back as H-15.
- H-11 (In vision) -> the unit section gains "Judging a loop or a compaction strategy takes
  sustained execution under real context pressure rather than a handful of turns, and that cost
  is the price of claiming those subjects at all."
- H-12 (Conditional, leaning meta-harness) -> applied. Bare **harness** now means the one under
  test; **meta-harness** is ours. Scope carries the rule and the reason. `CONTEXT.md`'s harness
  entry still says the opposite and needs rewriting to match.

## Round 4 - follow-ups the answers opened

| id | title | verdict | reasoning |
|---|---|---|---|
| H-13 | \1| **In vision** | Clarification: incorporating NVIDIA's skill evaluation tooling brings back into scope the option of a threshold at which something is high-signal enough that we refuse to publish. We still need clear caveats that we do not guarantee safety, so above that threshold we offer clearer labelling, never guarantees. |
| H-14 | \1| **In vision** |  |
| H-15 | \1| **Conditional** | Open to a different model that does not vendor, to provide real third-party separation. |

### Changelog - round 5

- H-13 (In vision, bounded) -> the publishing lines were rewritten: "Publishing is open by
  default and refused only on high-signal evidence: where detection is strong enough to stand on
  its own, a threshold may block a publish, and everything below it is labelled rather than
  gated", followed by "What sits above that threshold gets clearer labelling, never a guarantee
  - no verdict of ours is a safety guarantee ... and copy implying otherwise is a defect." Scope
  was reconciled with it: the product is "not an arbiter of what people are allowed to build: a
  refusal to publish is reserved for high-signal detections, never for taste, quality, or
  editorial preference." The old absolute "validation is offered, never enforced" is gone.
- H-14 (In vision) -> the distribution line stands, and one inferred line was added for
  confirmation: "A larger published unit needs a proportionate trust instrument, so what a badge
  covers is stated at the size of the thing published, and a profile's tool and runtime wiring is
  part of what a reader is told." Put back to the board as H-16, since it was inference rather
  than verdict.
- H-15 (Conditional, prefers real separation over vendoring) -> the external-tool line now ends
  "and the independent check stays outside our control rather than merely outside our imports - a
  judge we could edit under deadline pressure is not independent." Vendoring is not endorsed by
  the vision; the separation model stays open.

## Round 5 - one inferred line back for confirmation

| id | title | verdict | reasoning |
|---|---|---|---|
| H-16 | One badge, or an instrument per size | **In vision** | An instrument per size. We want to clearly differentiate our confidence levels; scanning skills for safety versus a harness is a very different proposition. |

### Changelog - final

- H-16 (In vision, an instrument per size) -> the inferred line stays and gains the reasoning:
  "Confidence is differentiated rather than flattened: scanning a skill for safety and judging a
  whole harness are different propositions, and one badge must never be stretched to speak for
  both."

Sixteen hypotheticals, sixteen recorded verdicts, no unanswered cards.

## Open follow-up

`CONTEXT.md`'s harness entry reserves the word for our side and explicitly forbids the
user-side sense this vision depends on. Rewriting it to the meta-harness convention is the
obvious next change and was left out of this pull request pending the author's call.
