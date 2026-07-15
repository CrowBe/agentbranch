import type { ReactNode } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { heroCapability } from "@/modules/hero";
import { createLintSummary } from "@/modules/lint";
import { makeSkill, parseSkillMd } from "@/modules/skill";
import { runCapability } from "@/modules/skill-analysis";
import { SkillId, UserId, unwrap } from "@/shared";
import { AppShell } from "./app-shell";
import { DraftControls } from "./draft-controls";
import { HeroPanel } from "./hero-panel";
import { InteractionPanel } from "./interaction-panel";
import { MermaidDiagram } from "./mermaid-diagram";
import { ModelConsole } from "./model-console";
import { SideRail } from "./side-rail";
import { ToolChips } from "./tool-chips";
import { TopBar } from "./top-bar";
import { Button } from "./ui/button";
import { Chip } from "./ui/chip";
import { Pill } from "./ui/pill";
import { Segmented } from "./ui/segmented";

/**
 * Visual regression over the design system (DESIGN.md §5.3): each gallery
 * renders a component group on the real token layer and compares a Chromium
 * screenshot against the committed baseline, in both themes. A drifted token,
 * a lost scrim, or an off-scale font fails here before a reviewer has to
 * notice it in the app.
 */

const SKILL_MD = `---
name: inbox-triage
description: Sorts unread email into respond, archive, or escalate, and drafts replies for the ones that need them.
---

# Goal

Help the user clear their inbox by triaging unread mail into three buckets and drafting replies where useful.

# Workflow

1. Fetch unread email.
2. For each message, decide: respond, archive, or escalate.
3. Draft a reply for anything in "respond".

# Constraints

Never auto-send a reply. Always leave drafts for the user to review and send.
`;

const source = unwrap(parseSkillMd(SKILL_MD));
const skill = makeSkill({
  id: SkillId("visual"),
  userId: UserId("visual-user"),
  source,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
});

function Frame({ children, width = 960 }: { children: ReactNode; width?: number }) {
  return (
    <div data-testid="frame" className="bg-background p-6" style={{ width }}>
      {children}
    </div>
  );
}

async function screenshotFrame(name: string) {
  await expect(page.getByTestId("frame")).toMatchScreenshot(name);
}

function Primitives() {
  return (
    <Frame>
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <Button variant="primary">Build skill</Button>
          <Button variant="secondary">Discard draft</Button>
          <Button variant="tertiary">Review constraint</Button>
          <Button variant="primary" disabled>
            Building…
          </Button>
        </div>
        <div className="flex items-center gap-3">
          <Chip accent="primary">Visualise</Chip>
          <Chip accent="secondary">Export</Chip>
          <Chip accent="tertiary">Triggers</Chip>
          <Chip accent="primary" disabled>
            Running…
          </Chip>
        </div>
        <div className="flex items-center gap-3">
          <Pill tone="success">safety badge</Pill>
          <Pill tone="warn">potentially unsafe</Pill>
          <Pill tone="error">failing</Pill>
          <Pill tone="neutral">Free plan</Pill>
        </div>
        <div className="flex items-center gap-3">
          <Segmented
            options={[
              { value: "rendered", label: "Rendered" },
              { value: "source", label: "Source" },
            ]}
            value="rendered"
            onChange={() => {}}
          />
          <Segmented
            options={[
              { value: "insights", label: "Insights" },
              { value: "breakdown", label: "Breakdown" },
            ]}
            value="breakdown"
            disabled
            onChange={() => {}}
          />
        </div>
      </div>
    </Frame>
  );
}

describe("ui primitives", () => {
  test("light", async () => {
    render(<Primitives />);
    await screenshotFrame("primitives-light");
  });

  test("dark", async () => {
    document.documentElement.dataset.theme = "dark";
    render(<Primitives />);
    await screenshotFrame("primitives-dark");
  });
});

async function heroProps() {
  const rendered = unwrap(await runCapability(heroCapability, "rendered", skill));
  const sourceDoc = unwrap(await runCapability(heroCapability, "source", skill));
  return { rendered, source: sourceDoc };
}

describe("hero document", () => {
  const noop = () => {};
  const base = {
    capability: null,
    activeTool: null,
    toolBusy: false,
    lintBusy: false,
    onViewChange: noop,
    onToolSelect: noop,
    onLintSelect: noop,
    onEvaluationSurfaceChange: noop,
    onLintSurfaceChange: noop,
    onSafetySurfaceChange: noop,
    onReviseWithFeedback: noop,
    feedbackBusy: false,
  } as const;

  test("rendered view with quality pill — light", async () => {
    const docs = await heroProps();
    render(
      <Frame>
        <HeroPanel {...base} {...docs} view="rendered" lintSummary={createLintSummary(source)} />
      </Frame>,
    );
    await screenshotFrame("hero-rendered-light");
  });

  test("source view — light", async () => {
    const docs = await heroProps();
    render(
      <Frame>
        <HeroPanel {...base} {...docs} view="source" lintSummary={null} />
      </Frame>,
    );
    await screenshotFrame("hero-source-light");
  });

  test("rendered view — dark", async () => {
    document.documentElement.dataset.theme = "dark";
    const docs = await heroProps();
    render(
      <Frame>
        <HeroPanel {...base} {...docs} view="rendered" lintSummary={createLintSummary(source)} />
      </Frame>,
    );
    await screenshotFrame("hero-rendered-dark");
  });
});

describe("shell chrome", () => {
  test("top bar, tool chips, draft banners — light", async () => {
    render(
      <Frame>
        <div className="flex flex-col gap-4">
          <TopBar onToggleMenu={() => {}} />
          <ToolChips active={null} onSelect={() => {}} />
          <DraftControls
            onDraft
            canStartDraft
            openDrafts={[]}
            busy={false}
            onStartDraft={() => {}}
            onOpenDraft={() => {}}
            onPromote={() => {}}
            onDiscard={() => {}}
          />
          <DraftControls
            onDraft={false}
            canStartDraft
            openDrafts={[{ id: "d1", revision: 3, name: "inbox-triage", description: null }]}
            busy={false}
            onStartDraft={() => {}}
            onOpenDraft={() => {}}
            onPromote={() => {}}
            onDiscard={() => {}}
          />
        </div>
      </Frame>,
    );
    await screenshotFrame("chrome-light");
  });

  test("side rail collapsed and expanded — light", async () => {
    render(
      <Frame width={480}>
        <div className="flex h-[560px] items-stretch gap-6">
          <SideRail expanded={false} active="build" />
          <SideRail expanded active="templates" />
        </div>
      </Frame>,
    );
    await screenshotFrame("side-rail-light");
  });

  test("interaction panel empty build state — light", async () => {
    render(
      <Frame width={360}>
        <div className="h-[480px]">
          <InteractionPanel entries={[]} mode="build" onSend={() => {}} />
        </div>
      </Frame>,
    );
    await screenshotFrame("interaction-panel-light");
  });
});

describe("compact shell (mobile-first arrangement)", () => {
  // Restore the suite viewport even when an assertion throws (e.g. first-run
  // baseline creation) so the phone viewport never leaks into later tests.
  afterEach(async () => {
    await page.viewport(1024, 768);
  });

  async function renderCompactShell() {
    await page.viewport(390, 844);
    const docs = await heroProps();
    render(
      <div data-testid="frame" className="bg-background" style={{ width: 390, height: 844 }}>
        <AppShell
          rendered={docs.rendered}
          source={docs.source}
          initialSkill={source}
          initialLintSummary={createLintSummary(source)}
        />
      </div>,
    );
  }

  test("chat tab is the main window", async () => {
    await renderCompactShell();
    await screenshotFrame("compact-chat");
  });

  test("skill tab shows the document", async () => {
    await renderCompactShell();
    await page.getByRole("button", { name: "Skill", exact: true }).click();
    await screenshotFrame("compact-skill");
  });
});

describe("theme sets", () => {
  // Per DESIGN §5.3: each custom theme set carries exactly one baseline —
  // the populated main screen in the desktop arrangement.
  async function renderMainScreen(themeId: string) {
    document.documentElement.dataset.theme = themeId;
    const docs = await heroProps();
    render(
      <div data-testid="frame" className="bg-background" style={{ width: 1024, height: 768 }}>
        <AppShell
          rendered={docs.rendered}
          source={docs.source}
          initialSkill={source}
          initialLintSummary={createLintSummary(source)}
        />
      </div>,
    );
  }

  test("tuxedo — populated main screen, desktop", async () => {
    await renderMainScreen("tuxedo");
    await screenshotFrame("main-tuxedo");
  });

  test("cardigan — populated main screen, desktop", async () => {
    await renderMainScreen("cardigan");
    await screenshotFrame("main-cardigan");
  });

  test("terminal — populated main screen, desktop", async () => {
    await renderMainScreen("terminal");
    await screenshotFrame("main-terminal");
  });
});

describe("mermaid diagram", () => {
  test("renders the visualise source as a themed diagram", async () => {
    render(
      <Frame>
        <MermaidDiagram
          source={
            "flowchart TD\n  start([Triggered])\n  n0[Goal]\n  n1[Workflow]\n  n2[/Never auto-send/]\n  end_([Done])\n  start --> n0\n  n0 --> n1\n  n1 --> n2\n  n2 --> end_"
          }
        />
      </Frame>,
    );
    await expect
      .poll(() => document.querySelector("figure[aria-label='Skill diagram'] svg") !== null, {
        timeout: 20000,
      })
      .toBe(true);
    await screenshotFrame("mermaid-diagram-light");
  });
});

describe("model console overlay", () => {
  test("scrim, elevation, provider cards — light", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          active: { providerId: "anthropic", modelIds: { default: "claude-sonnet-5" } },
          providers: [
            {
              id: "anthropic",
              label: "Anthropic",
              ready: true,
              hasServerKey: true,
              hasByoKey: false,
              modelIds: { default: "claude-sonnet-5" },
            },
            {
              id: "nous",
              label: "Nous Portal",
              ready: false,
              hasServerKey: false,
              hasByoKey: false,
              modelIds: { default: "hermes-4-405b" },
            },
          ],
        }),
      ),
    );
    render(
      <div data-testid="frame" className="bg-background relative h-[640px] w-[960px]">
        <p className="text-doc-rendered p-6">
          Content behind the overlay — the scrim must dim this.
        </p>
        <ModelConsole onClose={() => {}} />
      </div>,
    );
    await expect.poll(() => document.querySelectorAll("section").length).toBe(2);
    await screenshotFrame("model-console-light");
    vi.unstubAllGlobals();
  });
});
