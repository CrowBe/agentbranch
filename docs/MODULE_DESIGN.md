# SkillBuilder — module design

Agent-facing map of the codebase: the layers, the module boundaries, the
dependency rules, and where each thing lives. Read this with
[`ARCHITECTURE.md`](./ARCHITECTURE.md) (what we build & why) and
[`DESIGN.md`](./DESIGN.md) (visual system). A visual companion is
[`architecture.html`](./architecture.html) — open it in a browser.

> **Why this file exists:** to make the architecture *reviewable* and to keep
> future changes on-pattern. If a change doesn't fit one of the two rules in
> [§6](#6-how-to-extend-the-two-rules), that's the signal to stop and discuss.

---

## 1. The shape in one paragraph

Hexagonal + DDD. **Pure domain modules** (`src/modules/*`) hold all logic and
depend only on **ports** (interfaces they declare). **Infra** (`src/infra/*`)
implements those ports with real tech (Prisma, Clerk, the Vercel AI SDK) and
with in-memory/stub adapters for offline use. A **composition root**
(`src/server/container.ts`) is the single place ports meet adapters, chosen by
env flags. **Presentation** (`src/app`, `src/components`) renders. A shared
**kernel** (`src/shared`) carries cross-cutting primitives and depends on
nothing of ours. The **skill-analysis seam** is the spine: most features are a
*renderer* on it, not a new pipeline.

```
Presentation  (src/app, src/components)         depends ↓ on server + module barrels
Server        (src/server: container/config)    wires ports ↔ adapters
Domain        (src/modules/*)  ── ports ─┐       pure; no infra imports
Infra         (src/infra/*)    ── adapters┘      implements ports (Prisma/Clerk/AI/memory)
Kernel        (src/shared)                       depended on by all; depends on none
```

---

## 2. Dependency rules (the boundaries)

These are the invariants a reviewer should check. They are enforced by
convention + the `index.ts` barrels (and `import "server-only"` in the
container).

| Layer | May import | Must **not** import |
|---|---|---|
| `src/shared` | nothing of ours (only std lib / npm) | anything in `src/*` of ours |
| `src/modules/<m>` | `@/shared`, other modules **via their `index.ts`** | `@/infra/*`, `@/server/*`, `@/app/*`, React |
| `src/infra/<a>` | `@/shared`, the domain **ports** it implements, npm libs | `@/server/*`, `@/app/*`, other infra adapters |
| `src/server` | `@/shared`, `@/modules/*`, `@/infra/*` | `@/app/*` |
| presentation | `@/server/*` (route handlers), `@/modules/*` barrels | `@/infra/*` directly |

**Barrel rule:** cross-module imports go through `@/modules/<m>` (the
`index.ts`), never a deep path like `@/modules/skill/skill-md`. The barrel *is*
the public surface; everything else in the folder is private by convention.

**Direction of control:** the domain declares an interface (port); infra
depends on the domain to implement it. Dependencies point *inward* toward the
domain. The composition root is the only outer-to-inner wiring point.

---

## 3. The skill-analysis seam (read this before adding a feature)

`src/modules/skill-analysis` — built once, the spine of the product
(ARCHITECTURE §3.1).

```
analysis  Skill ─▶ Analyzer<A>.analyze() ──▶ Artifact ──▶ Renderer<A,S>.render() ─▶ Surface
                                       (carries SourceSpans)
          └──────────────── runCapability(capability, surface, skill) ─────────────────┘

evaluation Skill ─▶ Evaluator<A>.evaluate(skill, gateway) ─▶ Artifact ─▶ Renderer<A,S> ─▶ Surface
                          (owns method, model handed in)   (+ Insight)
          └────────── runEvaluation(capability, surface, skill, gateway) ──────────────┘
                          (guards model_unavailable once, here)
```

The seam carries **two capability shapes** (CONTEXT.md → Analysis / Evaluation):
**analysis** is static and runs offline; **evaluation** runs the skill through
the model gateway and may fail `model_unavailable`. Same `artifact → render`
tail; different head.

- **`ArtifactKind`** — closed union of valid kind strings (`"hero" | "skill-ir" | "export" | "test-run" | "triggering-eval"`). Add a new member here when a new capability needs its own artifact type. Free-string kinds are a compile error.
- **`Artifact<K>`** — the base artifact type; `K` must be an `ArtifactKind`. Each capability extends this with its own fields.
- **`Analyzer<A>`** — read a skill, emit a structured artifact. Async + `Result`
  (some analyzers call the model).
- **`Evaluator<A>`** — run the skill through the model and emit a result
  artifact. Owns its *method* (builds its own scenario / battery / distractors);
  the **model gateway** is handed in (`evaluate(skill, gateway)`). Composes the
  gateway's `classify` / `runAgent` / `generate` primitives; never touches the
  key or token accounting.
- **`Renderer<A, S>`** — pure, synchronous: artifact → one surface. Swapping the
  renderer is how a capability gets richer (Mermaid → React Flow; raw result →
  Insights).
- **`Insight`** — `{ verdict, summary, findings[], watch[] }`, the model-written
  interpretation an evaluator stores on its result via `gateway.generate`. The
  `insights` renderer (default, friendly) shapes it; `breakdown` exposes the raw
  cases/transcript.
- **`Capability`** — `defineCapability(...)` (analysis) or `defineEvaluation(...)`
  (evaluation): an analyzer/evaluator + named renderers.
- **`SourceSpan`** — `{ start, end }` back into `SKILL.md`. Carried by artifact
  nodes so "click → jump to source" (and later point-and-annotate) is free.
  Spans are computed with a scan-forward cursor, so duplicate headings resolve
  to the correct occurrence.

**Capabilities on the seam today:**

| Capability | Shape | Module | Analyzer / Evaluator | Renderer(s) | Status |
|---|---|---|---|---|---|
| Hero | analysis | `hero` | hero (sections + spans) | `rendered`, `source` | real |
| Visualise | analysis | `visualise` | IR extraction | `mermaid` | extract = stub, render = real |
| Export | analysis | `export` | instruction intent | `claude` (manifest) | real |
| Test run | evaluation | `test-run` | composes `gateway.runAgent` + mock-tool registry | `insights`, `breakdown` | run real; scenario/registry stubbed |
| Triggering eval | evaluation | `triggering-eval` | composes `gateway.classify` over the field | `insights`, `breakdown` | run real; battery/distractors stubbed |

Run an analysis: `runCapability(heroCapability, "rendered", skill)` →
`Result<RenderedDoc, DomainError>`. Run an evaluation:
`runEvaluation(triggeringEvalCapability, "insights", skill, gateway)` →
`Result<Insight, DomainError>` (fails `model_unavailable` offline).

---

## 4. Module-by-module

Each domain module is a folder under `src/modules/` with an `index.ts` public
surface and co-located `*.test.ts`. Status legend: **real** = load-bearing
logic implemented & tested · **wired** = real integration, guarded so it no-ops
without secrets · **stub** = deterministic placeholder behind the *real*
interface (marked `STUB` in-file) · **port** = interface only.

### Domain (`src/modules`)

| Module | Public surface (`index.ts`) | Port(s) it declares | Status |
|---|---|---|---|
| **skill** | `parseSkillMd`, `serializeSkillMd`, `makeSkill`, `reviseSkill`, `skillName/Description`, types | `SkillRepository` | real |
| **skill-analysis** | `defineCapability`, `runCapability`, `Analyzer/Renderer/Capability/SourceSpan/Artifact` | — | real |
| **hero** | `heroCapability`, `HeroView`, doc types | — | real |
| **visualise** | `visualiseCapability`, IR + Mermaid types | — | extract stub · render real |
| **test-run** | `testRunCapability`, `executeSkill`, `createMockToolRegistry`, `defaultMockToolRegistry`, `emailMockTool` | `TestRunRepository` | evaluation capability · run real · scenario/registry stubbed |
| **triggering-eval** | `triggeringEvalCapability`, `runTriggeringEval`, `buildPromptBattery`, `distractorLibrary` | `EvalRunRepository` | evaluation capability · run real · battery/distractors stubbed |
| **export** | `exportCapability`, manifest types | — | real |
| **portability** | `transformSkill`, types | — | stub (deferred engine) |
| **build-loop** | `runBuildLoop`, `buildTools`, `BuildToolName`, `BuildLoopEvent` | — (consumes `ModelGateway`) | real |
| **model-gateway** | `ModelGateway` (`classify`/`runAgent`/`streamAgent`/`generate`), `AccountingTag`, `GatewayTool`, `ModelProvider` | `ModelProvider` | real |
| **usage** | `checkCap`, `applyTurn`, `TIER_LIMITS`, types | `UsageRepository` | real |
| **auth** | `AuthPort`, `AuthIdentity` | `AuthPort` | port |

**Stub boundaries (where the real interface is set but behaviour is a
placeholder):**

- `visualise/extract-ir.ts` — derives a deterministic linear flowchart from
  headings; v1 replaces with a model-emitted IR. The IR *shape* is the real
  contract.
- `test-run/execute-skill.ts` — the *run* is real (composes `gateway.runAgent`
  with the mock tools as handlers, then `gateway.generate` for the Insight). The
  stub is the *inputs*: scenario + registry default to a single email mock
  (`STUB` in-file); v1 infers the registry from the skill and generates a
  stressing scenario.
- `triggering-eval/run-eval.ts` — the *run* is real (composes `gateway.classify`
  over candidate-vs-distractor field, then `gateway.generate` for the Insight).
  The stub is the *inputs*: `prompt-battery.ts` + `distractor-library.ts` are
  static/keyword (`STUB` in-file); v1 generates them.
- `portability/portability-transform.ts` — returns `not_configured`; one engine,
  two surfaces, both deferred (ARCHITECTURE §9).

### Infra (`src/infra`)

| Adapter | Implements | Notes |
|---|---|---|
| `memory/{skill,usage,test-run,eval}.memory-repository.ts` | the four repos | **offline default**, tested |
| `prisma/client.ts` | — | PrismaClient + `@prisma/adapter-pg` (Prisma 7 driver adapter) |
| `prisma/{skill,usage}.prisma-repository.ts` | `SkillRepository`, `UsageRepository` | real; test-run/eval Prisma repos follow same shape (todo) |
| `prisma/user-provisioning-auth.ts` | `AuthPort` | wraps Clerk auth, provisions the `users` row on first sight |
| `ai/model-gateway.ts` | `ModelGateway` | the metered gateway over a `ModelProvider`; routes accounting through `usage` |
| `ai/stub-model-gateway.ts` | `ModelGateway` | offline default; every primitive fails `model_unavailable` |
| `ai/anthropic-provider.ts` | `ModelProvider` | Claude via `@ai-sdk/anthropic`; `model: null` when no key |
| `ai/nous-provider.ts` | `ModelProvider` | Nous Portal via `@ai-sdk/openai-compatible`; `model: null` when no key |
| `ai/stub-provider.ts` | `ModelProvider` | always `model: null` |
| `clerk/clerk-auth.ts` | `AuthPort` | real Clerk server auth |
| `clerk/stub-auth.ts` | `AuthPort` | fixed dev identity |

### Server (`src/server`)

- `config.ts` — reads env → `AppConfig` with `flags { hasDatabase, hasModel, hasAuth }`.
- `container.ts` — `getContainer(): AppContainer` (cached). Picks Prisma vs
  memory, Clerk vs stub, Anthropic vs null **by flag**. `import "server-only"`.
- `build-stream.ts` — `buildLoopResponse(input, provider)`: drives
  `runBuildLoop` and encodes events as an SSE `Response`.

### Presentation (`src/app`, `src/components`)

- `app/page.tsx` (server) builds a demo skill and renders it through
  `heroCapability` → `AppShell`.
- `app/api/build/route.ts` — auth → stream; the **model gateway** owns the key
  and gates the `build` cap (the route never touches the raw model).
- `app/layout.tsx` — next/font + conditional `ClerkProvider`; `globals.css`
  holds the DESIGN tokens as CSS variables; `proxy.ts` is Clerk/passthrough.
- `components/` — `app-shell`, `top-bar`, `side-rail`, `hero-panel`,
  `view-toggle`, `tool-chips`, `interaction-panel`, `ui/{chip,button,pill}`.

---

## 5. The kernel (`src/shared`)

| Export | Purpose |
|---|---|
| `Result<T,E>`, `ok`, `err`, `isOk/isErr`, `mapResult`, `unwrap` | explicit success/failure at boundaries (domain returns these, doesn't throw across modules) |
| branded ids: `SkillId`, `UserId`, `SkillVersionId`, `TestRunId`, `EvalRunId` | structural string ids that don't interchange |
| `DomainError`, `domainError`, `notConfigured` | **closed discriminated union** — `tag` is the discriminant; callers can switch exhaustively. New tags go here, not in modules. |
| `SseEvent`, `encodeSse` | the typed SSE envelope shared by loop (server) and preview (client) |

**Known `DomainError` tags:**

| Tag | When |
|---|---|
| `not_configured` | adapter asked to act, backing service not set up (add secret to `.env.local`) |
| `not_found` | resource look-up returned nothing |
| `persistence_failed` | database operation failed |
| `auth_failed` | identity could not be resolved |
| `model_unavailable` | no model configured (offline / no key) |
| `cap_reached` | a model exists, but an `account` call hit a tier cap (the §8 graceful-degradation catch) |
| `seam_analyze_failed` | analyzer threw during seam execution |

Add a new tag to the union in `errors.ts` only when none of the above fits. Free-string tags are a compile error.

---

## 6. How to extend (the two rules)

Almost every change is one of these. If a task fits neither, surface it.

1. **New capability / view / analysis** → a **renderer on the seam**.
   Ask *"what renderer is this?"* before *"what service?"*. Write an
   `Analyzer` (if a new artifact) and one or more `Renderer`s, compose with
   `defineCapability`, expose from the module's `index.ts`. No new pipeline.

2. **New external service / persistence** → a **port + adapter**.
   Declare the interface in the owning domain module (e.g.
   `skill.repository.ts`), implement it in `src/infra/<tech>/`, and wire it in
   `container.ts` behind a config flag (with a memory/stub fallback so the app
   still boots offline).

**Other conventions**

- Return `Result` from fallible domain functions; only `unwrap` at trusted
  edges (tests, top-level handlers).
- Keep types co-located in the module and re-export from `index.ts`.
- New module? Mirror the layout: `index.ts` (barrel) + `<name>.types.ts` +
  logic files + `<name>.repository.ts` (if persisted) + `<name>.test.ts`.
- Anything model- or IO-driven that you can't finish: implement the **real
  interface**, stub the body, mark it `STUB` with a one-line note on what v1
  replaces it with.

---

## 7. Commands & runtime facts

```bash
pnpm dev        # run the app           pnpm typecheck   # tsc --noEmit
pnpm build      # production build      pnpm lint        # eslint
pnpm test       # vitest (run once)     pnpm test:watch
pnpm db:generate / db:push / db:migrate # Prisma (needs DATABASE_URL)
```

- **Boots with no secrets.** Missing `DATABASE_URL` / Clerk keys / selected
  model-provider key (`ANTHROPIC_API_KEY` or `NOUS_API_KEY`) ⇒ memory + stub
  adapters. Copy `.env.example` → `.env.local` to switch to real services.
- Stack: Next 16 (App Router) · React 19 · Prisma 7 (pg driver adapter,
  `prisma.config.ts`) · Clerk 7 · Vercel AI SDK 6 (`@ai-sdk/anthropic`,
  `@ai-sdk/openai-compatible`, Claude default with optional Nous Portal) ·
  Tailwind 4 · Vitest 4 · pnpm.
- Data model lives in `prisma/schema.prisma` (ARCHITECTURE §6): `users`,
  `skills`, `skill_versions` (append-only), `usage`, `test_runs`, `eval_runs`.

---

## 8. Review checklist

- [ ] Do the layer boundaries hold? (no `@/infra` import from a domain module;
      cross-module imports go through barrels)
- [ ] Is the seam the right spine — are hero/visualise/export genuinely
      renderers, or is something leaking pipeline?
- [ ] Are the ports at the right grain (repositories, `ModelProvider`,
      `AuthPort`)? Anything that should be a port but is hard-wired?
- [ ] Are the stub boundaries in the right places, with real interfaces around
      them?
- [ ] Data model: does `skill_versions` append-only + export-from-record match
      how export/eval should evolve?
- [ ] Anything in `ARCHITECTURE.md` that this structure makes awkward to build?
