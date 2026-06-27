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
- **Overlay** (popover / modal / menu / floating voice control) — surface-high + soft shadow, **no blur** (light: `0 8px 24px rgba(11,28,48,.12)`; dark: `0 10px 32px rgba(0,0,0,.40)`).

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

> **Contrast rule:** on light surfaces, amber `#b8730a` is the only AA-safe amber for **text**; the brighter `#f59e0b` is for fill/border/dot only. Cobalt and teal are darkened on light for the same reason.

---

## 5. Components

Behaviour identical across themes; colors resolve from §4 roles.

- **Buttons** — Primary: solid `primary`, `radius-sm`. Secondary: ghost `secondary` outline. Warning/constraint: solid `tertiary` (amber). Copy is **sentence-case, plain-language** ("Test this skill", not "EXEC").
- **Inputs** — filled surface + 1px `outline-variant`; focus → `primary` border + 2px `primary`/30% ring (no glow blur).
- **Cards & hero** — `surface` + 1px `outline-variant`, `radius-lg`, generous `space-lg` padding. Rendered hero uses `doc-rendered`/`doc-rendered-h`; Source view uses `doc-source`/`doc-source-fm` with a streaming caret.
- **Hero view toggle** — a small segmented control on the hero header: **Rendered | Source**, defaulting Rendered. Sentence-case labels.
- **Chips** (tool surfaces) — `radius-md`, sentence-case `label`. Accent fill ~15% + solid accent text. Visualise/Run = `primary`; Triggers = `tertiary`; Export = `secondary`.
- **State pills** (`radius-full`) — success = `secondary`, warn = `tertiary`, error = `error`.
- **Streaming indicator** — `secondary` (teal) dot + label while writing; settles to `on-surface-variant` idle.

---

## 6. Not yet designed

- **Rendered-view layout detail** — how sections / trigger-logic render as friendly cards/lists (the actual SMB-facing document design). Highest-value next design pass.
- **Diagram theming** (Mermaid → React Flow) — palette from §4 roles; specify when Visualise is built.
- **Floating voice control** styling (ARCH §9).
- **Logged-out / landing** visual treatment — the SMB owner's *true* first impression.
- **Final mono pick** — JetBrains Mono assumed; open on license/character grounds.
