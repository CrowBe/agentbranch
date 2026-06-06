# Security design — user input → LLM guardrails

Status: **proposal for review** (not yet implemented). This is a design/threat
doc, deliberately separate from `ARCHITECTURE.md` / `DESIGN.md` (which read as
current state). Once a slice is agreed and built, fold the *settled* rules into
ARCHITECTURE and delete the corresponding "planned" sections here.

## 1. Threat model

SkillBuilder's purpose is to take user-authored **instructions** (a `SKILL.md`)
and a chat conversation, and feed them to a model through the **model gateway**
(the platform's single metered entry to the model, holding the provider key). So
the headline fact — *user text reaches the LLM* — is not a bug to sanitize away;
it **is** the product. The design goal is not to scrub that surface but to
**bound it, meter it, and contain it where content crosses a trust boundary.**

### What is *not* worth defending (avoid security theater)

- **"Prompt-injection detection" on the build-loop chat.** The user is the
  legitimate instructor of the authoring agent. Sessions are single-tenant —
  your skill, your session, your model spend. Injection here is self-injection:
  low severity. Regex/keyword injection filters and special-character stripping
  would break legitimate authoring (skills routinely contain prompt-shaped text)
  and give false confidence. **Out of scope.**

### What *is* worth defending (real risks, by severity)

| # | Risk | Where | Why it matters |
|---|------|-------|----------------|
| R1 | **Cost / quota abuse** | `src/app/api/build/route.ts:8` `bodySchema`; all `/api/*` routes | `usage` caps turns/tokens *after* the call. Nothing bounds a *single* request — unbounded `content`, unbounded skill `body`, uncapped `messages[]`. One request can be enormous and burn provider cost before `checkCap` recounts. |
| R2 | **Burst abuse / DoS** | All routes | No per-user request-rate limit. The daily token cap only stops you *after* the damage; a tight loop of large requests spends fast. |
| R3 | **Untrusted-when-shared content** | `import`/`export` capabilities (`src/modules/usage/meter.ts:29`) | A skill you author is trusted to you. The moment a `SKILL.md` crosses users via import, its body + frontmatter are untrusted input to *someone else's* model run and browser. |
| R4 | **Eval re-interpolation** | `classifyPrompt` (`src/infra/ai/model-gateway.ts:273`); insight prompts in `test-run` / `triggering-eval` | Skill content **and model output** (rationales, transcripts) get spliced back into *new* prompts. Rationale/transcript lengths are unbounded → cost inflation + content bleeding across the system/user boundary. |
| R5 | **Output rendering (XSS)** | Hero Rendered view | *Currently safe* — `hero-panel.tsx:50` interpolates `{section.body}` via JSX (React auto-escapes); no `dangerouslySetInnerHTML` anywhere. Listed to **protect the invariant**, especially once R3 (imported content) lands. |
| R6 | **Second-order SQL injection** | future readers of `skills` / `skill_versions` | *Not live today* (no raw SQL — see §4). But stored skill strings become a stored SQLi payload the moment anyone adds `$queryRawUnsafe`/template-literal SQL for search/admin/analytics. The risk is a future erosion of the parameterized-only convention, so it must be a guardrail, not a hope. |
| R7 | **Broken access control / IDOR** | `findById` (`skill.prisma-repository.ts:82`); `TestRun`/`EvalRun` `findById` | Ownership is re-checked in the *caller* (`build-stream.ts:51`), not the *query*. Any future route that calls `findById` and forgets the check leaks another user's skill. Test/eval `findById` are scoped only by run id — a leaked CUID exposes another user's scenario/transcript. This is the most plausible cross-user data leak. |
| R8 | **JSON column abuse** | `frontmatterJson` (`extra: Record<string, unknown>`) | Stored as a Json column, unbounded — arbitrary nested/huge JSON → storage bloat (cost/DoS), and prototype pollution (`__proto__`/`constructor` keys) if ever deep-merged. |
| R9 | **Sensitive content in logs** | `domainError(msg, cause)`; any stdout / observability | Skill bodies or prompts leaking into error causes or platform logs is an exfil path that bypasses the DB entirely. |

### Current guardrails (already in place — keep)

- Auth on every LLM-hitting route (Clerk OAuth; 401 when signed out).
- Tier caps via `usage` — `checkCap` gates capability + turns + tokens in the
  gateway's `admit()` before spend (`model-gateway.ts:54`).
- Capability gating (`free` lacks `triggering-eval`).
- Zod schema validation on request bodies (types only — see gaps).
- Lossless, validated `SKILL.md` YAML parse (rejects malformed/non-object).
- Classification output guarded against hallucinated labels (`model-gateway.ts:108`).
- Output auto-escaped by React in the Rendered view.
- **Persistence is parameterized-only** — all writes go through Prisma's query
  builder (`prisma.skill.create/update`, `testRun.create`, `evalRun.create`,
  `usage.upsert`); a full-tree search for `$queryRaw*`/`$executeRaw*` returns
  zero hits. No raw-SQL escape hatch exists.
- **Ownership re-checked before save** — `build-stream.ts:51` rejects when
  `existing.userId !== userId`.
- **Raw user prompts are not persisted** — only the resulting `SKILL.md`.
- **No secrets in the DB** — provider/API keys and Clerk secrets stay in env.

### Gaps this proposal closes

1. No **max length / size** on user strings (message `content`, skill
   `name`/`description`/`body`) or on `messages[]` length / total request bytes.
2. No **per-request budget** enforced at the gateway chokepoint.
3. No **per-user rate limit** independent of the daily token cap.
4. No **bounds on re-interpolated** rationales/transcripts in eval insight prompts.
5. No explicit **trust boundary** treatment for imported skills.
6. No **lint guard** locking in the parameterized-only / no-`*Unsafe` invariant.
7. Ownership is enforced in **callers, not queries** (`findById` lacks a `userId`
   scope; test/eval `findById` lack ownership entirely).
8. `frontmatterJson` is **unbounded and unsanitized** (size, depth, unsafe keys).
9. No explicit rule that skill content / prompts **must not be logged**.

## 2. Design principles

- **Bound at the edge, enforce at the chokepoint.** Validate per-surface with
  zod at the API edge (fast, cheap rejection before any spend), *and* keep a
  single defense-in-depth budget check inside the gateway's `admit()` so the
  guarantee can't be bypassed by a caller that forgot a schema.
- **One source of truth for limits.** A single `limits` constants module —
  no magic numbers scattered across routes.
- **Reject, don't truncate.** Silent truncation corrupts the user's skill
  invisibly. Violations return a clear, warm-pro, sentence-case message (copy in
  §4). Confirmed behavior choice.
- **Don't filter content, bound it.** Limits are about *size and shape*, never
  *meaning*. No injection regexes.
- **Treat the gateway as the security boundary**, consistent with its role as
  the single metered entry to the model.

## 3. Proposed changes (prioritized, incremental)

Each phase is independently shippable. Recommended order P0 → P3.

### P0 — Input size limits (highest value, lowest risk)

New module: `src/shared/limits.ts` (kernel — limits are cross-cutting policy).

```
SKILL_NAME_MAX        = 100        // frontmatter name
SKILL_DESCRIPTION_MAX = 1_024      // frontmatter description (triggering text)
SKILL_BODY_MAX        = 50_000     // SKILL.md body
MESSAGE_CONTENT_MAX   = 16_000     // a single chat message
MESSAGES_MAX          = 100        // turns in one build request
REQUEST_BYTES_MAX     = 256_000    // total JSON payload
```
(Numbers are starting points — tune against real skills before locking in.)

- **Edge:** apply `.max(...)` in `bodySchema` (`api/build/route.ts:8`) and the
  shared `skillSourceSchema` (`api/_shared/skill-request.ts`), plus
  `.max(MESSAGES_MAX)` on the array. Reject oversized JSON by `Content-Length` /
  byte count before `request.json()`.
- **Errors:** map zod failures to specific, surface-aware messages (§4) instead
  of the current generic `"Invalid request body."`.

### P1 — Gateway budget check (defense in depth)

In `admit()` (`model-gateway.ts:54`), before returning the model, sum the
char/byte length of `system` + all `messages[].content` (and `prompt` for
`classify`/`generate`) and reject over a ceiling with a new
`domainError("input_too_large", …)`. Catches any caller that bypasses an edge
schema (evals, future internal callers). Surfaces as a normal gateway `Result`
error / streamed error event — same path as `cap_reached`.

### P2 — Per-user rate limiting

A small limiter beside `usage` (it already is the accounting authority):
fixed-window or token-bucket, e.g. `REQUESTS_PER_MINUTE` per user per
capability. In-memory adapter for the offline/stub default; Postgres/Redis
adapter for production — wired in `container.ts` like other ports. Checked in
`admit()` alongside `checkCap`. Returns `cap_reached`-style error → "you're
going a bit fast, try again in a few seconds."

### P3 — Re-interpolation bounds + import trust boundary

- **Bound re-interpolated content:** clamp `rationale` and per-step transcript
  text before they re-enter insight prompts (`triggering-eval` insight,
  `test-run` insight); add `.max()` to generated prompt-battery items (schema
  currently relies on the instruction "under 160 chars", not enforced).
- **Import as untrusted:** run imported `SKILL.md` through the *strict* end of
  the limits (same caps, hard reject — never truncate-to-fit), and add a test
  asserting the Rendered view never gains `dangerouslySetInnerHTML` (protects
  R5/the XSS invariant once cross-user content exists).

## 4. Persistence & data-at-rest

When skill content (and, later, possibly prompts) is saved, the threat shifts
from "input → model" to "what's stored, who can read it, and how it's read
back." The reassuring part: classic **SQL-injection-on-save is not possible
today** (parameterized-only writes, no raw SQL — see Current guardrails). The
work here is to convert that *convention* into *enforced invariants* and to close
the access-control and JSON-shape gaps before the data store grows.

### 4.1 Data inventory & sensitivity

| Asset | Table / column | User-controlled | Sensitivity | Notes |
|---|---|---|---|---|
| Skill body / description / name / frontmatter | `skills`, `skill_versions` | **Yes** | **Medium–High** | The crown jewel. For SMB-owner users this can encode confidential business processes. `skill_versions` keeps full history, so deletes don't fully erase. |
| Email | `users.email` | No (OAuth) | Medium (PII) | Cleartext, unique-indexed. |
| Test/eval scenarios + transcripts | `test_runs`, `eval_runs` (`*Json`) | Indirect | Low–Medium | System-generated but derived from the skill; reachable via the R7 enumeration gap. |
| Usage counters | `usage` | No | Low | Aggregate tokens/turns only; no per-request content. |
| Raw user prompts / chat | **not persisted** | — | — | Only the resulting `SKILL.md` is saved today. See 4.5. |
| Provider/API keys, Clerk secrets | **not in DB** | — | — | Env vars only. |

### 4.2 Lock in parameterized-only (R6 — second-order SQLi)

- Add an **ESLint rule** (e.g. `no-restricted-syntax` / a Prisma-aware lint)
  that bans `$queryRawUnsafe`, `$executeRawUnsafe`, and tagged-template
  `$queryRaw`/`$executeRaw` built from non-literal expressions. Treat any raw
  SQL as an explicit, reviewed exception with a justifying comment.
- Document the rule in `ARCHITECTURE.md` (data section) so it survives as a
  standing constraint, not a doc buried here.
- This means stored content stays inert *forever*, even when a search/admin
  feature is added later — which is exactly when second-order SQLi would
  otherwise appear.

### 4.3 Ownership in the query, not the caller (R7 — IDOR)

- Change `findById` to scope by owner: `where: { id, userId }` (return
  not-found when the owner doesn't match), so the boundary is enforced by the
  database, not by remembering to re-check in each caller. Keep the
  `build-stream.ts:51` check as belt-and-suspenders.
- Apply the same to `TestRun`/`EvalRun` `findById` (add `userId` scope) and to
  any `listBySkill` path — verify the caller has proven skill ownership first.
- Add a test that a second user's id cannot read or overwrite the first user's
  skill / test-run / eval-run by id.

### 4.4 Bound & sanitize `frontmatterJson` (R8)

- Reuse the §3 limits: cap serialized `frontmatterJson` size, max nesting
  depth, and key count; reject the keys `__proto__`, `constructor`,
  `prototype` on parse (in `skill-md.ts`, before persistence).
- Never deep-merge untrusted frontmatter into a shared object; treat it as a
  plain data bag.

### 4.5 Decide prompt persistence *deliberately* (R9-adjacent)

- Today raw prompts are ephemeral. **If** conversation history is added later,
  it creates a new, higher-sensitivity store (free-text user input, possibly
  pasted secrets/PII). That should be an explicit, reviewed decision — with
  retention limits and the same ownership-in-query scoping — not something that
  drifts in via a feature PR.

### 4.6 Don't log content (R9)

- Add a standing rule: skill `body`, frontmatter values, and message `content`
  must never be passed to loggers or attached to `domainError` causes that get
  logged. Audit existing `domainError(..., cause)` sites and any request
  logging for content leakage.

### 4.7 Persistence phases

- **P4 — invariants:** ESLint no-raw-unsafe rule (4.2) + ownership-in-query for
  skills/test-runs/eval-runs (4.3). Highest value, smallest surface.
- **P5 — shape & hygiene:** `frontmatterJson` bounds/sanitization (4.4) +
  no-content-logging audit (4.6). Pairs naturally with the §3 P0 size limits.

## 5. Error copy (warm-pro, sentence-case)

Reject on violation. Plain language, no jargon, tells the user what to do:

- Skill body too long: *"This skill is longer than we can build in one go —
  trim it to under 50,000 characters and try again."*
- Name too long: *"That name is a bit long — keep it under 100 characters."*
- Description too long: *"Keep the description under ~1,000 characters so it
  stays a crisp trigger."*
- Message too long: *"That message is too long to send — shorten it and try
  again."*
- Too many messages: *"This conversation is too long to continue — start a new
  skill to keep going."*
- Request too large / gateway budget: *"That's too much to send at once — try a
  smaller change."*
- Rate limited: *"You're going a little fast — give it a few seconds and try
  again."*
- Frontmatter too large/complex: *"The skill's settings are too large or deeply
  nested — simplify the frontmatter and try again."*
- Skill not found / not yours (IDOR response): *"We couldn't find that skill."*
  (Deliberately not "you don't have access" — don't confirm the id exists.)

## 6. Testing

- Unit: each schema rejects at limit+1 and accepts at limit; gateway `admit()`
  rejects oversized payloads with `input_too_large`.
- Unit: rate limiter allows N then rejects N+1 within the window, recovers after.
- Regression/invariant: a test that fails if `dangerouslySetInnerHTML` appears
  in the hero render path.
- Manual: oversized paste in the build chat surfaces the right copy, no spend.
- Persistence (R7): a second user cannot read or overwrite another user's skill,
  test-run, or eval-run by id (`findById` returns not-found across owners).
- Persistence (R8): frontmatter exceeding size/depth/key limits is rejected;
  `__proto__`/`constructor`/`prototype` keys are stripped or rejected on parse.
- Persistence (R6): a lint/CI check fails if `*RawUnsafe` or non-literal raw SQL
  is introduced.

## 7. Explicitly out of scope

- Prompt-injection / jailbreak *detection* on legitimate authoring input.
- Content/meaning filtering or special-character stripping.
- Model **output** moderation (separate concern; R5 is handled by escaping).
- Multi-tenant skill sharing model beyond the existing import/export caps.
- Encryption-at-rest of skill content / email beyond what the DB host provides
  (note it; defer unless a compliance requirement lands).
