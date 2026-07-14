# agent.branch — Design System

> The **visual design system**: theme, color tokens, type scale, spacing, shapes, components.
> Categorically distinct from `ARCHITECTURE.md` (what we build & why, incl. screen *layout*).
> If layout and theme ever disagree, **`ARCHITECTURE.md` §7 (Frontend / app shell) wins** — this file dresses that shell, it doesn't redefine it. The shell it dresses: preview-primary hero, chrome-only top bar, collapsed 56px rail, slim 300px right panel, tool chips.

---

## 1. Audience & personality — the bridge

Two users, one identity (per `ARCHITECTURE.md` §1):

- **The technical builder** — comfortable with `SKILL.md`, YAML, trigger logic. Wants a credible pro-tool.
- **The non-technical SMB owner** — automating admin (inbox, scheduling, docs) with AI. A wall of monospace YAML is a bounce point.

**Identity = "warm-pro": one professional-but-approachable system, not a fork.** Not a dev IDE; not a toy. The discipline that keeps it from drifting either way:

> **Warmth comes from type, copy, and spacing. Professionalism comes from restraint and structure.**
> Don't buy warmth with bright colors or big rounded everything (→ toy). Don't buy credibility with austere mono-everything dark chrome (→ alienates SMB). Plain sentence-case language, generous whitespace, and a human type voice do the warming; a tight palette and clear structure do the professionalising.

**Light is the default theme** (the welcoming first impression); **dark is a power-user preference.**

**Surfaces are flat** — 1px border, no fill-blur; shadow is overlay-only. Flatness serves the clarity the tool is for.

---

## 2. The hero: Rendered vs. Source (the load-bearing decision)

The hero has **two views** (affordance lives in `ARCHITECTURE.md` §7; both reuse the skill-analysis seam, `ARCHITECTURE.md` §3.1):

### Rendered view — **default**

The skill as a **friendly structured document**, sans-serif (Inter). Title, plain-language description, sections as readable prose/cards, trigger logic as a legible list. **No visible YAML, no monospace wall.** This is what the SMB owner sees first. Streaming reads as *a document assembling itself* — sections appear and fill in.

### Source view — **toggle**

The raw streaming `SKILL.md`: YAML frontmatter + markdown, **JetBrains Mono**, blinking caret. One click away. Streaming reads as *code being typed*.

> **Why this matters most:** the raw monospace artifact is the single biggest "this is for programmers" signal in the app. Rendered-default removes that wall without hiding the artifact from anyone who wants it.

---

## 3. Shared structural tokens (theme-independent)

Identical across light and dark. Only the **color** layer (§4) swaps.

### 3.1 Type families

| Role | Family | Used for |
|---|---|---|
| Display / headings | **Hanken Grotesk** (600/700) | Screen titles, skill name, section headers |
| Body / UI / **Rendered hero** | **Inter** (400/500/600) | Body copy, controls, the Rendered document view, labels |
| **Mono** | **JetBrains Mono** (400/500) | The Source view of the hero, code/YAML blocks, technical metadata |

> Mono dresses the **Source view**, not the default Rendered hero; the Rendered default is Inter. JetBrains Mono is loaded in **both** themes.

### 3.2 Type scale

| Token | Family | Size / line | Weight | Tracking |
|---|---|---|---|---|
| `display-lg` | Hanken Grotesk | 48 / 56 | 700 | -0.02em |
| `headline-xl` | Hanken Grotesk | 40 / 48 | 700 | -0.02em |
| `headline-lg` | Hanken Grotesk | 32 / 40 | 600 | -0.01em |
| `headline-md` | Hanken Grotesk | 24 / 32 | 600 | — |
| `body-lg` | Inter | 18 / 28 | 400 | — |
| `body-md` | Inter | 16 / 24 | 400 | — |
| `body-sm` | Inter | 14 / 20 | 400 | — |
| `doc-rendered` | Inter | 16 / 26 | 400 | 0 |
| `doc-rendered-h` | Hanken Grotesk | 20 / 28 | 600 | -0.01em |
| `label` | Inter | 12 / 16 | 600 | 0.02em (sentence-case) |
| `label-caps` | JetBrains Mono | 12 / 16 | 500 | 0.05em (UPPER) — *use sparingly* |
| `doc-source` | JetBrains Mono | 14 / 22 | 400 | 0 |
| `doc-source-fm` | JetBrains Mono | 13 / 20 | 400 | 0 |

> `doc-rendered` / `doc-rendered-h` are the friendly default hero; `doc-source` / `doc-source-fm` are the mono Source view. **`label` (sentence-case Inter) is the default micro-label; `label-caps` (uppercase mono) is reserved for genuinely technical metadata** — uppercase-mono everywhere reads cold (the austere failure mode §1 warns against).

### 3.3 Spacing (one canonical scale)

| Token | px | | Token | px |
|---|---|---|---|---|
| `space-xs` | 4 | | `space-xl` | 32 |
| `space-sm` | 8 | | `gutter` | 24 |
| `space-md` | 16 | | `margin-mobile` | 16 |
| `space-lg` | 24 | | `margin-desktop` | 32 |

Warmth lever: lean to the **generous** end of this scale. Whitespace is the cheapest warmth in a warm-pro system.

### 3.4 Layout tokens (mapped to ARCHITECTURE §7)

| Token | Value | Note |
|---|---|---|
| `topbar-height` | 48px | Thin chrome bar (no nav links) |
| `rail-width` | 56px | Collapsed left nav (default) |
| `menu-width` | 240px | Expanded left slideout |
| `panel-width` | 300px | Slim right interaction panel |
| — hero — | fluid | Single centred document; **not** a card/bento grid |

### 3.5 Radius

| Token | Value | Used for |
|---|---|---|
| `radius-sm` | 4px (0.25rem) | Buttons, inputs — friendly but disciplined |
| `radius-md` | 8px (0.5rem) | Chips, small surfaces |
| `radius-lg` | 12px (0.75rem) | Cards, the hero document container |
| `radius-xl` | 16px (1rem) | Large panels / modals |
| `radius-full` | 9999px | Pills & avatars |

### 3.6 Elevation

Flat by default; shadow **overlay-only**.

- **Base / canvas** — background color, no border.
- **Surface / card / hero** — surface + **1px border**, no shadow.
- **Overlay** (popover / modal / menu / floating voice control) — surface + **1px border** + soft shadow (the `elevation-overlay` class), **no blur** (light: `0 8px 24px rgba(11,28,48,.12)`; dark: `0 10px 32px rgba(0,0,0,.40)`), floating over a **`scrim` at 40% opacity** (§4) that dims the page behind it.

### 3.7 Focus

Every interactive element gets a visible `:focus-visible` ring: **2px solid `primary`, 2px offset** — no glow blur (§3.6 flatness). Inputs swap it for their own focus treatment (§5) so the ring never doubles a focused border.

---

## 4. Color themes

Identical semantic role names; only hex differs. Functional accent triad is constant in meaning:

- **Primary = Cobalt** — primary actions, active nav, selection, focus.
- **Secondary = Teal** — success, "active/healthy", secondary data.
- **Tertiary = Amber** — warnings, **constraints/policy** (a skill's "never auto-send" rule renders amber).
- **Error = Red** — failure/destructive.

### 4.1 Light theme — **DEFAULT** (the welcoming face)

| Role | Hex |
|---|---|
| `background` | `#fbfbfd` |
| `surface` | `#ffffff` |
| `surface-high` | `#f1f3f9` |
| `on-surface` | `#141a24` |
| `on-surface-variant` (muted) | `#4b5366` |
| `outline` | `#737686` |
| `outline-variant` (borders) | `#dcdfe8` |
| `primary` (cobalt) | `#004ac6` |
| `on-primary` | `#ffffff` |
| `secondary` (teal) | `#006a61` |
| `on-secondary` | `#ffffff` |
| `tertiary` (amber) | `#b8730a` |
| `on-tertiary` | `#ffffff` |
| `error` | `#ba1a1a` |
| `on-error` | `#ffffff` |
| `scrim` | `#0b1c30` |

### 4.2 Dark theme — power-user option

| Role | Hex |
|---|---|
| `background` | `#0f172a` |
| `surface` | `#1e293b` |
| `surface-high` | `#222a3d` |
| `on-surface` | `#dae2fd` |
| `on-surface-variant` (muted) | `#94a3b8` |
| `outline` | `#475569` |
| `outline-variant` (borders) | `#334155` |
| `primary` (cobalt) | `#2563eb` |
| `on-primary` | `#ffffff` |
| `secondary` (teal) | `#0d9488` |
| `on-secondary` | `#ffffff` |
| `tertiary` (amber) | `#f59e0b` |
| `on-tertiary` | `#0f172a` |
| `error` | `#ef4444` |
| `on-error` | `#ffffff` |
| `scrim` | `#000000` |

> `scrim` is only ever used at **40% opacity** behind overlays (§3.6) — never as a fill.

> **Contrast rule:** on light surfaces, amber `#b8730a` is the only AA-safe amber for **text**; the brighter `#f59e0b` is for fill/border/dot only. Cobalt and teal are darkened on light for the same reason.

---

## 5. Components

Behaviour identical across themes; colors resolve from §4 roles. Copy is **sentence-case, plain-language** everywhere; trailing activity copy uses a true ellipsis (`Building…`, never `Building...`).

### 5.1 Primitives (`src/components/ui`)

- **Buttons** — Primary: solid `primary`, `radius-sm`. Secondary: ghost `secondary` outline. Warning/constraint: solid `tertiary` (amber). ("Test this skill", not "EXEC".)
- **Inputs & textareas** — filled surface + 1px `outline-variant`; focus → `primary` border + 2px `primary`/30% ring (no glow blur).
- **Segmented control** — the one two-way-switch treatment: outlined `outline-variant` container at `radius-md` with 2px inset, active segment = `primary`/15 fill + solid `primary` text (the chips' accent language), inactive = muted with `surface-high` hover. Used by the hero's **Rendered | Source** toggle (defaults Rendered) and the **Insights | Breakdown** surface tabs; any future two-view switch reuses it.
- **Chips** (tool surfaces) — `radius-md`, sentence-case `label`. Accent fill ~15% + solid accent text. Visualise/Run = `primary`; Triggers/Safety = `tertiary`; Export = `secondary`. Busy chip reads `Running…`.
- **State pills** (`radius-full`) — success = `secondary`/15 + `secondary` text, warn = `tertiary`/15 + `tertiary`, error = `error`/15 + `error`, neutral = `surface-high` + muted. Pills carry *states and metadata*, never actions.

### 5.2 Composites

- **Cards & hero** — `surface` + 1px `outline-variant`, `radius-lg`, generous `space-lg` padding. Rendered hero uses `doc-rendered`/`doc-rendered-h`; Source view uses `doc-source`/`doc-source-fm` with a streaming caret.
- **Quality pill** (hero header) — the lint summary as a pill-shaped button: grade + score, toned by severity (clean = `secondary`, warnings/C = `tertiary`, errors/D = `error`). Opens the lint Insights surface.
- **Draft banner** (branching iteration) — the state-legibility strip above the hero. *Editing a draft*: `primary`/40 border + `primary`/5 fill, `label` in `primary`, with **Discard draft** / **Set as main version**. *Viewing the main version*: plain `surface` + `outline-variant`, with **Resume draft** / **Start a draft**. Never git vocabulary (§1 tone; CONTEXT.md).
- **Insights / Breakdown surfaces** — every evaluation and lint result renders Insights-first: `label` eyebrow (the capability name), `headline-md` verdict, `doc-rendered` summary, findings/watch as lists. Breakdown sits behind the segmented tabs: per-case cards (`radius-sm`, 1px border) with pass/fail as `doc-rendered-h`, metadata as muted `label`; test-run transcripts are `doc-source` blocks on `surface-high`.
- **Overlays** (model console) — `scrim`/40 backdrop, panel = `surface` + 1px `outline-variant` + `radius-xl` + `elevation-overlay` (§3.6). Never Tailwind `shadow-*` utilities.
- **Trust & safety marks** (publish surfaces) — the **safety badge** renders as a success pill; **"potentially unsafe — not validated"** renders as a warn pill, copy kept blunt (ARCHITECTURE §9.1). Trust tier, category, and `#tags` are neutral pills. Safety verdicts on the hero: passed / needs review / blocked as headline + per-class score cards in the breakdown.
- **Nav rail** — active item = `primary`/10 fill + `primary` text, `radius-md`; inactive = muted with `surface-high` hover. Labels appear only when expanded (`menu-width`); collapsed buttons keep `aria-label`s.
- **Plan chip** (top bar) — the free-tier status as a **neutral** pill; it flips to warn only when usage is actually exhausted ("out of free usage today"). Plan identity is metadata, not a success state.
- **Status line** — the shell's one `role="status"` live region, below the hero: `label` type in `on-surface-variant`. Every action lands a sentence there; errors repeat as an error-toned entry in the interaction drawer.
- **Streaming indicator** — `secondary` (teal) dot + label while writing; settles to `on-surface-variant` idle.

### 5.3 Conformance

The token layer lives in `src/app/globals.css` (CSS variables + the §3.2 type-scale classes); components compose those and never hard-code hex values, raw font sizes, or Tailwind palette colors. Guarded by `src/meta/design-conformance.test.ts` (tokens ⇄ this doc ⇄ component usage) and the visual suite (`npm run test:visual`).

---

## 6. Not yet designed

- **Rendered-view layout detail** — how sections / trigger-logic render as friendly cards/lists (the actual SMB-facing document design). Highest-value next design pass.
- **Responsive / mobile shell** — the shell is desktop-only today (fixed rail + 300px panel; `margin-mobile` is unused). Needs a collapse order: panel → drawer, rail → sheet, hero full-bleed.
- **Theme switch surface** — dark tokens ship but nothing user-facing sets `data-theme`; needs a home (account menu, not the chrome bar) once account UI exists.
- **Icon system** — the rail uses unicode glyphs as placeholders; pick a real icon set (stroke-consistent, 18–20px grid) before the surface grows further.
- **Interaction drawer voices** — user turns, agent turns, and system notices currently share one text treatment; needs a quiet visual split that stays a control surface, not a chat app.
- **Diagram theming** (Mermaid → React Flow) — palette from §4 roles; Visualise currently shows the Mermaid source as a `doc-source` block, awaiting a real diagram render.
- **Floating voice control** styling (ARCH §9).
- **Logged-out / landing** visual treatment — the SMB owner's *true* first impression, including the public skill profile pages' relationship to it.
