import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "./app-shell";
import type { RenderedDoc, SourceDoc } from "@/modules/hero";
import type { SkillSource } from "@/modules/skill";

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
});
