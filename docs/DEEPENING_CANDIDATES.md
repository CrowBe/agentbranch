# Deepening candidates — working queue

Open candidates from the 2026-07-04 architecture review, written for a session
with clean context. **This is a work queue, not architecture knowledge** (that
lives in `ARCHITECTURE.md` / `MODULE_DESIGN.md`): delete a candidate when it
lands or is rejected, delete the file with the last one. Don't let it grow into
a decision log — CLAUDE.md forbids those.

Candidate 1 from that review (give the evaluation run one home behind the
skill-analysis seam) already landed: `f5bf003`, `src/server/evaluation-run.ts`.
It also dissolved the review's speculative fourth candidate (route-preamble
duplication) for the two evaluation routes.

## How to work a candidate (the flow that landed candidate 1)

The review and design flow come from Matt Pocock's public skills — not mounted
in this repo, fetch the raw files:

- `https://raw.githubusercontent.com/mattpocock/skills/main/skills/engineering/improve-codebase-architecture/SKILL.md`
- `https://raw.githubusercontent.com/mattpocock/skills/main/skills/engineering/codebase-design/SKILL.md` (the vocabulary: module, interface, implementation, depth, seam, adapter, leverage, locality — use these terms exactly)
- `https://raw.githubusercontent.com/mattpocock/skills/main/skills/productivity/grilling/SKILL.md`

The flow:

1. **Read first**: `CONTEXT.md` (domain language is non-negotiable),
   `docs/ARCHITECTURE.md`, `docs/MODULE_DESIGN.md`. This repo keeps decisions
   in those living docs — there is no `docs/adr/`; don't re-litigate what they
   record.
2. **Grill before building.** Walk the candidate's design tree with the user
   one question at a time, each with a recommended answer; resolve dependencies
   between decisions branch by branch. If the code can answer a question, read
   the code instead of asking. Do not implement until the user confirms shared
   understanding of the final shape.
3. **Implement, verify, push**: typecheck + `npm test` + `npm run lint` +
   `npm run check:docs` + `npx knip` (advisory — add no *new* entries), plus a
   real end-to-end exercise of the changed surface. Update `MODULE_DESIGN.md`
   in the same commit so its claims stay true. Amend `CONTEXT.md` only if a new
   *domain* concept was named (candidate 1 needed none).

Worked example of the question grain, from candidate 1's grilling: where does
the deepened run live (seam vs server driver — chose the server driver because
CONTEXT.md keeps Evaluation results ephemeral on the seam) · how does
per-capability recording vary get absorbed (chose a kind-keyed exhaustive
dispatch in the driver) · what is the observer contract (chose a discriminated
union event in `seam.types.ts`, the `BuildLoopEvent` pattern) · does offline
stay an HTTP 503 on the SSE path (yes — refactors don't smuggle behavior
changes).

---

## Candidate 2 — Deepen the client workspace (Strong)

**Files:** `src/components/app-shell.tsx` (~1,190 lines) ·
`src/components/use-build-stream.ts` · `src/components/hero-panel.tsx` (the
panel types it exports to the shell)

**Problem.** The app shell is one module whose interface is nearly its whole
implementation: 13 state cells, ~12 fetch handlers each repeating the same
choreography (guard busy → set status → fetch → decode → apply → append
entries → clear busy), and ~37 hand-rolled `unknown` guards
(`toSkillDetail`, `isTriggeringResult`, `toBranchDetail`, …) that re-derive
response shapes the domain modules already export as types — the server's
knowledge re-learned across the HTTP seam. Its only test surface is React
rendering (`app-shell.test.tsx`).

**Solution shape.** Extract a framework-free workspace module owning the
protocol and the choreography behind a small interface — actions (start draft,
open draft, promote, discard, run tool, lint, import, open skill, restore
version) over one state snapshot, with a single typed decoder per route. The
app shell becomes a renderer wired to that interface.

**Wins.** Locality: response-shape drift breaks in one decoder, not 37 guards.
Leverage: one choreography serves twelve actions. The interface shrinks; the
implementation absorbs the guards. Tests drive actions and assert the snapshot
without rendering React.

**Design tree to grill (roots, not conclusions):**

- Where does the workspace module live? It is client-side and React-adjacent —
  `src/components/` convention vs. a new home; check MODULE_DESIGN §2's layer
  table before inventing a layer.
- How does it relate to `useBuildStream`? The build stream already owns part of
  the state (heroDocs, entries, busy, current skill); merging vs. composing is
  a real fork.
- Decoder strategy: hand-written one-per-route vs. zod schemas; and whether the
  route response types should be exported from one shared place so client and
  server stop drifting (the kernel's `SseEvent`/`EvaluationEvent` is the
  precedent for shared wire types).
- Snapshot ↔ React binding: `useSyncExternalStore` vs. a thin hook holding the
  snapshot in `useState`.
- What survives of `app-shell.test.tsx` (508 lines) vs. moves to workspace
  tests.

---

## Candidate 3 — Move accounting policy out of the SDK adapter (Worth exploring)

**Files:** `src/infra/ai/model-gateway.ts` (~580 lines) ·
`src/modules/model-gateway/` (currently interface-only) ·
`src/infra/ai/model-gateway.test.ts` (~730 lines)

**Problem.** CONTEXT.md says the gateway "depends on the usage module for
policy" — but the enforcement (`admit`: `checkCap`, request rate limit, byte
budget; `record`: token accounting) is implemented inside the one infra
adapter, fused with the AI-SDK plumbing. The domain module declares the
interface and implements nothing. Testing admission means `vi.mock("ai")`
wholesale; a second gateway adapter would silently ship without policy.

**Solution shape.** Split the seam in two: a domain accounting shell in
`modules/model-gateway` that implements `ModelGateway` around a narrower
raw-model-calls port (unmetered `classify` / `runAgent` / `streamAgent` /
`generate`); the infra adapter shrinks to SDK translation (`toSdk*` mapping,
stream-part mapping, token-usage-shape heuristics, provider cap-error
detection).

**Wins.** Locality: policy enforced in one place, for every adapter by
construction. Admission tests drop `vi.mock("ai")` and run against memory
usage/rate-limit adapters through the shell's interface.

**Honest caveat (why not Strong):** the raw-calls port would have a single
production adapter — one adapter means a hypothetical seam. The payoff is
policy locality and testability, not substitution. If that isn't load-bearing
when picked up, it can wait.

**Design tree to grill (roots):**

- The raw port's exact grain: per-primitive methods mirroring the gateway, or
  one `call(primitive, input)`? Where does the resolved model/effort selection
  cross — does the shell call the router, or does the raw port resolve
  internally per call (runtime provider switching must keep working)?
- `streamAgent` is the hard case: admission happens before the stream, token
  recording happens *inside/after* it (including the disconnect/error paths and
  the provider-cap detection that skips recording). Which side of the seam owns
  the record-once discipline?
- Where do the usage-shape heuristics (`readTokenUsage`, `firstNumberDeep`)
  and `isProviderCapError` live? They read SDK/provider shapes — infra — but
  `record` consumes their output; the port's return shape decides this.
- Migration of the 726-line test: which cases become shell tests (policy,
  memory adapters) vs. stay as adapter tests (SDK translation, still mocked).

---

Review artifact (diagrams, before/after):
https://claude.ai/code/artifact/796b93ce-8b05-46d8-88bb-8b1c9e79054d — session
-scoped link; the substance above is self-contained.
