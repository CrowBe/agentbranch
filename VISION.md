# Vision

`agent.branch` exists so that the harness layer of an agentic system can be evaluated rather than guessed at.
It serves whoever assembles that layer, from the builder fluent in `SKILL.md` and trigger logic to the small-business owner who should never have to read a line of YAML, and it turns what they assembled into evidence about how it behaves.
It owns exactly one thing: the human-in-the-loop evaluation of a harness, so that a setup which improves itself never also holds the judgement of whether it improved.

## The unit is the harness layer, not the skill

The subject of evaluation is anything living in the harness layer: skills, tool and MCP surfaces, subagent definitions, agent loops, compaction and context strategy, policies, instructions, model settings.
Skills are core because they are ubiquitous, not because they define the product.
The question we answer has the shape "how good is this setup for this job", not "is this file well written".
Everything is brought and opt-in: nothing is evaluated that the user did not hand over, at whatever size they hold it - one primitive, a few that work together, a whole configuration, a complete harness - and the smallest unit is never asked to become the largest before it is admitted.
The model is a variable of the setup, not a subject of it: results are reported per provider and model because that variable moves them, and we draw no conclusions about the model itself.
A primitive earns support when it changes what the assembled harness does, not because it is a file format we could parse.
Judging a loop or a compaction strategy takes sustained execution under real context pressure rather than a handful of turns, and that cost is the price of claiming those subjects at all.
Distribution scales with the subject: what can be evaluated should become publishable and importable, up to a whole proven profile that somebody else adopts instead of rebuilding.
A larger published unit needs a proportionate trust instrument, so what a badge covers is stated at the size of the thing published, and a profile's tool and runtime wiring is part of what a reader is told.
Confidence is differentiated rather than flattened: scanning a skill for safety and judging a whole harness are different propositions, and one badge must never be stretched to speak for both.

## Proof is the product; bringing and building are both entrances

Every intake surface exists to produce something an evaluation can judge, and a capability earns its place by what it lets someone learn about their setup rather than by what it lets them type.
Import is a first-class entrance, not a migration convenience, because most people already hold the thing they want judged.
A diagnosis with no way to act on it is half a product: whatever we can evaluate, a person must be able to change and re-evaluate here, so authoring broadens with the subject rather than narrowing - every primitive we judge is one we work toward letting someone create and iterate on.
No evaluation ships as a data wall: every result renders as plain-language Insights first, with the full record one step away.
An evaluation that no surface can reach is not a shipped capability, however well tested the engine is.

## The human is the loop's gate

A loop that can rewrite its own judge optimises the judge instead of the behaviour, so whatever proposes a change must not also hold the gate that accepts it, at every scale where a loop closes.
Self-improvement is the point and the human in the loop is what makes it safe: the system may propose, measure, rank and explain, and a person accepts.
The product's work is to surface what was opaque about a harness and hand the decision to a person; approval is the value on offer, not friction to be optimised away.
Generated cases enter a suite as visible proposals and become ground truth only through an explicit review action.
Execution evidence is immutable and every judgement is versioned and pinned, so a changed grader produces a new attributable judgement rather than silently rewriting an old one.
A third-party benchmark keeps this repository from being the only judge of its own meta-harness.
Three evaluation layers stay named and separate: the evaluation we ship to users, the regression benchmark that grades the meta-harness, and the third-party benchmark that checks that benchmark; collapsing any two of them is a defect, not a simplification.
Scoring a proxy for the thing that decides a user-visible verdict is not scoring it, and scoring detection alone is not scoring a judge: an adversarial cohort needs a benign cohort beside it, so that blocking everything scores zero.

## Honest beats reassuring

We report what we measured, at the confidence we measured it, and we name what we did not measure.
Cross-runtime work is a behaviour check on other runtimes, never a claim that anything runs identically everywhere, and it is a commitment we accelerate toward rather than trade away - once the subject is a whole harness, whether a setup survives a different runtime is a central question rather than a portability footnote.
Publishing is open by default and refused only on high-signal evidence: where detection is strong enough to stand on its own, a threshold may block a publish, and everything below it is labelled rather than gated - a published version without a passing rating pinned to its exact content hash is labelled potentially unsafe and not validated, in blunt copy.
What sits above that threshold gets clearer labelling, never a guarantee - no verdict of ours is a safety guarantee, a rating is a claim about an artifact and never a promise about a runtime we do not control, and copy implying otherwise is a defect.
Known blind spots are written down as accepted residuals and frozen into tests, not quietly left out of the report.
Statistical claims carry their interval, and an interval containing zero is reported as no evidence rather than dressed up as a finding.
Capabilities fail honestly and distinguishably: out of quota, no model configured, and a request too large for the balance left are three different sentences.

## One seam, one meter

A new capability is classified before it is built: analysis is pure, offline and recomputed; evaluation runs through a model, costs tokens and persists.
A larger subject is a larger input on the same seam, never a second pipeline beside it.
Every model call the platform makes goes through the one metered gateway, which owns accounting, above a router that owns credentials and selection.
An evaluation should run on the inference provider the harness under test itself uses wherever that provider is reachable, because a result produced on our substitute describes our setup rather than theirs; evidence produced by a host's own call is recorded as such, never mixed in silently.
New runtimes arrive as adapters at the boundary, translating into the neutral domain vocabulary, never as forks of the product or as runtime names inside the domain model.
An external tool can be borrowed for its contracts and pinned as a development dependency without becoming part of the product, and the independent check stays outside our control rather than merely outside our imports - a judge we could edit under deadline pressure is not independent.

## What we read, and what we never touch

We improve the meta-harness from what users bring, and we say so plainly instead of burying it: configuration and evaluation records are read, and nothing private is.
That line is published rather than implied, and it is exactly why real-data integrations stay out of the product - material we never hold cannot leak into a corpus, and a runtime's own plugin is where real-credential behaviour gets explored, at that runtime's risk.
We do not run a harness under test against real credentials or production systems.
We never silently normalise away configuration we did not understand: unknown files and unknown fields survive import intact, because invisible loss is worse than a refusal.
Imported material is validated, bounded and never executed; secret-bearing files are not read, the preview names every secret removed at the boundary, nothing persists until the user confirms, and credential surfaces fail safe rather than fail open.
What the user exports is theirs, in the open standard's own layout where one exists, installable without this tool.

## Scope

It is not a general agent IDE, not an agent runtime, not a CI system for other people's repositories, and not a judge of the application the agent serves.
It is not an arbiter of what people are allowed to build: a refusal to publish is reserved for high-signal detections, never for taste, quality, or editorial preference.
Evaluation happens on our surfaces, where a result can be pinned to a version, compared against another, and explained; a verdict rendered somewhere we cannot pin it is not worth having.
Harness means the one under test, the layer somebody brings and we judge; ours has its own name, the meta-harness - the versioned set of prompts, rules, generators, batteries and judges that produce our verdicts, and the thing we grade ourselves on.
A sentence where harness could mean either is a defect: attribution runs on both axes at once, and a word meaning the judge and the judged makes neither axis mean anything.
The docs are the current state, with one home per piece of knowledge and one term per concept, and this repository is held to the standard it sells: drift is guarded mechanically, and the meta-harness is graded on frozen ground before it is called improved.

A change aligns when it produces new evidence about how an assembled harness behaves, leaves a human holding the gate that accepts any proposal, reports its uncertainty and its blind spots, arrives on the existing seam as a larger or better-judged input, and leaves what the user brought intact and theirs.
A change should be resisted when it makes the product its own only judge, removes the human from a loop that changes the user's setup, converts a labelled risk into a silent one, buys reassurance with a claim we cannot measure, adds a parallel pipeline beside the seam, executes or normalises something we did not understand, or grows the tool by becoming a second product rather than by taking a bigger subject.
