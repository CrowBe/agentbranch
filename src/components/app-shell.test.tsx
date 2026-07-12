import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "./app-shell";
import type { RenderedDoc, SourceDoc } from "@/modules/hero";
import type { SkillSource } from "@/modules/skill";
import { encodeSse } from "@/shared";

const skill: SkillSource = {
  frontmatter: {
    name: "inbox-triage",
    description: "Sort unread mail into useful buckets.",
    extra: {},
  },
  body: "# Goal\n\nClear the inbox.",
};

const rendered: RenderedDoc = {
  title: "inbox-triage",
  description: "Sort unread mail into useful buckets.",
  sections: [],
};

const source: SourceDoc = {
  markdown: "---\nname: inbox-triage\n---\n# Goal\n\nClear the inbox.",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AppShell capability chips", () => {
  it("opens the current skill quality report from the hero chip", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        score: 73,
        grade: "C",
        summary: "This skill has a few warnings.",
        findings: [],
        watch: ["Add clearer usage boundaries."],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AppShell
        rendered={rendered}
        source={source}
        initialSkill={skill}
        initialLintSummary={{ score: 73, grade: "C", counts: { error: 0, warn: 2, info: 1 } }}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Quality C 73/100" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/lint",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            skill,
            currentSkillId: undefined,
            surface: "insights",
          }),
        }),
      );
    });
    expect(await screen.findByText("This skill has a few warnings.")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Quality ready.");
  });

  it("imports pasted SKILL.md and renders the saved skill", async () => {
    const importedSkill: SkillSource = {
      frontmatter: {
        name: "calendar-planner",
        description: "Plan calendar meetings from plain language requests.",
        extra: {},
      },
      body: "# Steps\n\nCheck availability.",
    };
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        skill: { id: "skill-1", source: importedSkill, latestRevision: 1 },
        rendered: {
          title: "calendar-planner",
          description: "Plan calendar meetings from plain language requests.",
          sections: [],
        },
        source: {
          markdown:
            "---\nname: calendar-planner\ndescription: Plan calendar meetings from plain language requests.\n---\n# Steps\n\nCheck availability.",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<AppShell rendered={rendered} source={source} initialSkill={skill} />);

    await userEvent.click(screen.getByRole("button", { name: "Import" }));
    expect(screen.getByRole("heading", { name: "Import a skill" })).toBeInTheDocument();
    await userEvent.type(
      screen.getByRole("textbox"),
      "---\nname: calendar-planner\ndescription: Plan calendar meetings from plain language requests.\n---\n# Steps\n\nCheck availability.",
    );
    await userEvent.click(screen.getByRole("button", { name: "Import skill" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/import", {
        method: "POST",
        headers: { "Content-Type": "text/markdown; charset=utf-8" },
        body: "---\nname: calendar-planner\ndescription: Plan calendar meetings from plain language requests.\n---\n# Steps\n\nCheck availability.",
      });
    });
    expect(await screen.findByText("calendar-planner")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Import complete.");
  });

  it("imports a public GitHub skill URL", async () => {
    const importedSkill: SkillSource = {
      frontmatter: {
        name: "repo-summarizer",
        description: "Summarize repository changes from GitHub.",
        extra: {},
      },
      body: "# Steps\n\nRead the repository.",
    };
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        skill: { id: "skill-1", source: importedSkill, latestRevision: 1 },
        rendered: {
          title: "repo-summarizer",
          description: "Summarize repository changes from GitHub.",
          sections: [],
        },
        source: {
          markdown:
            "---\nname: repo-summarizer\ndescription: Summarize repository changes from GitHub.\n---\n# Steps\n\nRead the repository.",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<AppShell rendered={rendered} source={source} initialSkill={skill} />);

    await userEvent.click(screen.getByRole("button", { name: "Import" }));
    await userEvent.type(
      screen.getByRole("textbox"),
      "https://github.com/acme/skills/tree/main/repo-summarizer",
    );
    await userEvent.click(screen.getByRole("button", { name: "Import skill" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: "https://github.com/acme/skills/tree/main/repo-summarizer" }),
      });
    });
    expect(await screen.findByText("repo-summarizer")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Import complete.");
  });

  it("opens Templates from the rail and searches the Skill library feed", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          surface: "templates",
          entries: [
            {
              name: "inbox-triage",
              owner: "ben",
              slug: "ben/inbox-triage",
              tier: "reviewed",
              trustLabel: "reviewed skill - human-reviewed",
              safety: { status: "potentially-unsafe", label: "potentially unsafe — not validated", ratingId: null },
              surfaced: true,
              contentHash: "sha256:template",
              description: "Triage unread email into priority buckets.",
              category: "email",
              tags: ["triage", "inbox"],
              source: { type: "git", ref: "HEAD", path: "skills/ben/inbox-triage" },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(Response.json({ surface: "templates", entries: [] }));
    vi.stubGlobal("fetch", fetchMock);

    render(<AppShell rendered={rendered} source={source} initialSkill={skill} />);

    await userEvent.click(screen.getByRole("button", { name: "Templates" }));

    expect(await screen.findByRole("heading", { name: "Templates" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/skill-library?surface=templates");
    expect(await screen.findByText("potentially unsafe — not validated", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("Hash sha256:template", { exact: false })).toBeInTheDocument();

    await userEvent.type(screen.getByRole("textbox"), "calendar");
    await userEvent.click(screen.getByRole("button", { name: "Search" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith("/api/skill-library?surface=templates&q=calendar");
    });
    expect(screen.getByRole("status")).toHaveTextContent("No matching Templates.");
  });

  it("auto-injects lint feedback after a written skill with findings", async () => {
    const writtenSkill: SkillSource = {
      frontmatter: {
        name: "calendar-planner",
        description: "Plan calendar meetings from plain language requests.",
        extra: {},
      },
      body: "# Steps\n\nCheck availability.",
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        sseResponse([
          { event: "skill", data: { source: writtenSkill } },
          { event: "skill-checkpoint", data: { skillId: "skill-1" } },
          {
            event: "lint-feedback",
            data: {
              feedback:
                "Lint - Quality C 70/100\n\nWarnings:\n- Add an example so the intended behaviour is concrete.",
            },
          },
          { event: "done", data: { skillId: "skill-1", revision: 1 } },
        ]),
      )
      .mockResolvedValueOnce(sseResponse([{ event: "done", data: { skillId: "skill-1", revision: 2 } }]));
    vi.stubGlobal("fetch", fetchMock);

    render(<AppShell rendered={rendered} source={source} initialSkill={skill} />);

    await userEvent.type(screen.getByRole("textbox"), "Make a calendar planner");
    await userEvent.click(screen.getByRole("button", { name: "Build skill" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const lintRequest = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(lintRequest.messages).toEqual([
      { role: "user", content: "Make a calendar planner" },
      expect.objectContaining({
        role: "user",
        content: expect.stringContaining("Lint - Quality C 70/100"),
      }),
    ]);
    expect(lintRequest.current).toEqual(writtenSkill);
    expect(lintRequest.currentSkillId).toBe("skill-1");
  });

  it("calls the visualise route with the current skill and renders the result", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        mermaid: "flowchart TD\n  A --> B",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<AppShell rendered={rendered} source={source} initialSkill={skill} />);

    await userEvent.click(screen.getByRole("button", { name: "Visualise" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/visualise",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            skill,
            currentSkillId: undefined,
            surface: "insights",
          }),
        }),
      );
    });
    expect(await screen.findByText("flowchart TD", { exact: false })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Visualise ready.");
  });

  it("shows the triggering eval free-plan gate without leaving the chip busy", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json(
        { error: "cap reached", code: "cap_reached" },
        { status: 429 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<AppShell rendered={rendered} source={source} initialSkill={skill} />);

    await userEvent.click(screen.getByRole("button", { name: "Triggers" }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        "Triggering eval is not available on the free plan.",
      );
    });
    expect(screen.getByRole("button", { name: "Triggers" })).toBeEnabled();
  });

  it("requests and renders a test-run breakdown on demand", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          verdict: "needs-attention",
          summary: "The skill missed one tool call.",
          findings: ["Missing calendar lookup."],
          watch: [],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          scenario: { prompt: "Triage a calendar-heavy inbox.", seedData: {} },
          transcript: [
            { kind: "model", text: "I will inspect the inbox." },
            { kind: "tool-call", tool: "email.search", input: { query: "unread" } },
          ],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(<AppShell rendered={rendered} source={source} initialSkill={skill} />);

    await userEvent.click(screen.getByRole("button", { name: "Run" }));

    await screen.findByText("The skill missed one tool call.");
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/test-run",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          skill,
          currentSkillId: undefined,
          surface: "insights",
        }),
      }),
    );

    await userEvent.click(screen.getByRole("button", { name: "Breakdown" }));

    await screen.findByText("Triage a calendar-heavy inbox.");
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/test-run",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          skill,
          currentSkillId: undefined,
          surface: "breakdown",
        }),
      }),
    );
    expect(screen.getByText("email.search", { exact: false })).toBeInTheDocument();
  });

  it("renders streamed triggering eval progress before the final artifact", async () => {
    const encoder = new TextEncoder();
    let releaseArtifact!: () => void;
    const artifactReady = new Promise<void>((resolve) => {
      releaseArtifact = resolve;
    });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        new ReadableStream<Uint8Array>({
          async start(controller) {
            controller.enqueue(
              encoder.encode(
                encodeSse({
                  event: "eval-progress",
                  data: { message: "Building prompt battery." },
                }),
              ),
            );
            await artifactReady;
            controller.enqueue(
              encoder.encode(
                encodeSse({
                  event: "eval-case",
                  data: {
                    index: 1,
                    total: 1,
                    prompt: "Schedule a planning meeting.",
                    expected: "fire",
                    actual: "fire",
                    pass: true,
                    rationale: "Matched the calendar skill.",
                  },
                }),
              ),
            );
            controller.enqueue(
              encoder.encode(
                encodeSse({
                  event: "artifact",
                  data: {
                    surface: "insights",
                    body: {
                      verdict: "good",
                      summary: "Fires correctly.",
                      findings: ["Matched the right prompt."],
                      watch: [],
                    },
                  },
                }),
              ),
            );
            controller.close();
          },
        }),
        { headers: { "Content-Type": "text/event-stream; charset=utf-8" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<AppShell rendered={rendered} source={source} initialSkill={skill} />);

    await userEvent.click(screen.getByRole("button", { name: "Triggers" }));

    expect(await screen.findAllByText("Building prompt battery.")).toHaveLength(2);
    releaseArtifact();
    expect(await screen.findByText("Fires correctly.")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/triggering-eval",
      expect.objectContaining({
        headers: expect.objectContaining({ Accept: "text/event-stream" }),
      }),
    );
  });

  it("sends triggering eval feedback back through the build loop", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        sseResponse([
          {
            event: "artifact",
            data: {
              surface: "insights",
              body: {
                verdict: "failing",
                summary: "The skill fires on unrelated email prompts.",
                findings: ["Matches calendar prompts."],
                watch: ["Also fires on email drafting."],
              },
              result: {
                kind: "triggering-eval",
                passed: false,
                insight: {
                  verdict: "failing",
                  summary: "The skill fires on unrelated email prompts.",
                  findings: ["Matches calendar prompts."],
                  watch: ["Also fires on email drafting."],
                },
                cases: [
                  {
                    prompt: "Draft a customer follow-up email.",
                    expected: "silent",
                    actual: "fire",
                    pass: false,
                    rationale: "The description is too broad.",
                  },
                ],
              },
            },
          },
        ]),
      )
      .mockResolvedValueOnce(sseResponse([{ event: "done", data: { skillId: "skill-1" } }]));
    vi.stubGlobal("fetch", fetchMock);

    render(<AppShell rendered={rendered} source={source} initialSkill={skill} />);

    await userEvent.click(screen.getByRole("button", { name: "Triggers" }));
    await screen.findByText("The skill fires on unrelated email prompts.");

    await userEvent.click(screen.getByRole("button", { name: "Revise with this feedback" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith(
        "/api/build",
        expect.objectContaining({ method: "POST" }),
      );
    });
    const buildRequest = JSON.parse(String(fetchMock.mock.calls.at(-1)?.[1]?.body));
    expect(buildRequest.messages).toEqual([
      expect.objectContaining({
        role: "user",
        content: expect.stringContaining("Triggering eval - failing"),
      }),
    ]);
    expect(buildRequest.messages[0].content).toContain("Draft a customer follow-up email.");
    expect(buildRequest.current).toEqual(skill);
  });

  it("shows the revise action on test-run insights", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      sseResponse([
        {
          event: "artifact",
          data: {
            surface: "insights",
            body: {
              verdict: "needs-attention",
              summary: "The skill skipped prioritisation.",
              findings: ["Called the ticket search tool."],
              watch: [],
            },
            result: {
              kind: "test-run",
              scenario: { prompt: "Summarise recent tickets.", seedData: { customer: "Acme" } },
              contractChecks: [],
              insight: {
                verdict: "needs-attention",
                summary: "The skill skipped prioritisation.",
                findings: ["Called the ticket search tool."],
                watch: [],
              },
              transcript: [
                { kind: "model", text: "I will inspect tickets." },
                { kind: "tool-call", tool: "ticket.search", input: { customer: "Acme" } },
              ],
            },
          },
        },
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<AppShell rendered={rendered} source={source} initialSkill={skill} />);

    await userEvent.click(screen.getByRole("button", { name: "Run" }));

    expect(await screen.findByText("The skill skipped prioritisation.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Revise with this feedback" })).toBeInTheDocument();
  });
});

function sseResponse(events: readonly { readonly event: string; readonly data: unknown }[]): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        events.forEach((event) => controller.enqueue(encoder.encode(encodeSse(event))));
        controller.close();
      },
    }),
    { headers: { "Content-Type": "text/event-stream; charset=utf-8" } },
  );
}
