import { describe, expect, it, vi } from "vitest";
import { encodeSse, SKILL_NAME_MAX } from "@/shared";
import type { SkillSource } from "@/modules/skill";
import { createDeterministicLocalSuggestionProvider, createWorkspace } from "./index";

const skill: SkillSource = {
  frontmatter: {
    name: "inbox-triage",
    description: "Sort unread mail into useful buckets.",
    extra: {},
  },
  body: "# Goal\n\nClear the inbox.",
};

const init = {
  rendered: { title: "inbox-triage", description: "Sort unread mail into useful buckets.", sections: [] },
  source: { markdown: "---\nname: inbox-triage\n---\n# Goal\n\nClear the inbox." },
  initialSkill: skill,
};

const savedSkill = {
  id: "skill-1",
  source: skill,
  latestRevision: 2,
  lintSummary: { score: 88, grade: "B" as const, counts: { error: 0, warn: 1, info: 0 } },
};

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

describe("workspace choreography", () => {
  const metadataSuggestion = {
    name: "inbox-priority-triage",
    description: "Prioritise unread email and draft the next action when the inbox needs triage.",
    category: "email",
    tags: ["email", "inbox-triage", "prioritisation"],
    rationale: "The skill sorts unread inbox messages by urgency.",
  };

  it("uses the local metadata rung and applies only after the author accepts", async () => {
    const fetchMock = vi.fn();
    const workspace = createWorkspace(init, {
      fetch: fetchMock,
      localSuggestionProvider: createDeterministicLocalSuggestionProvider(metadataSuggestion),
    });

    await workspace.actions.runTool("metadata");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(workspace.getSnapshot().current).toEqual(skill);
    expect(workspace.getSnapshot().capability).toMatchObject({
      kind: "metadata-suggestion",
      provenance: "on-device",
      name: "inbox-priority-triage",
    });

    workspace.actions.applyMetadataSuggestion();
    expect(workspace.getSnapshot().current?.frontmatter).toMatchObject({
      name: "inbox-priority-triage",
      description: metadataSuggestion.description,
      extra: { category: "email", tags: metadataSuggestion.tags },
    });
    expect(workspace.getSnapshot().status).toContain("Run Triggers");
  });

  it("silently falls through from unavailable local metadata to the gateway route", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({
      ...metadataSuggestion,
      current: { category: null, tags: [] },
    }));
    const workspace = createWorkspace(init, {
      fetch: fetchMock,
      localSuggestionProvider: createDeterministicLocalSuggestionProvider(null),
    });

    await workspace.actions.runTool("metadata");

    expect(fetchMock).toHaveBeenCalledWith("/api/metadata-suggest", expect.objectContaining({ method: "POST" }));
    expect(workspace.getSnapshot().capability).toMatchObject({
      kind: "metadata-suggestion",
      provenance: "route",
    });
  });

  it("falls through when local metadata would make the skill invalid", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({
      ...metadataSuggestion,
      current: { category: null, tags: [] },
    }));
    const workspace = createWorkspace(init, {
      fetch: fetchMock,
      localSuggestionProvider: createDeterministicLocalSuggestionProvider({
        ...metadataSuggestion,
        name: "x".repeat(SKILL_NAME_MAX + 1),
      }),
    });

    await workspace.actions.runTool("metadata");

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(workspace.getSnapshot().capability).toMatchObject({
      kind: "metadata-suggestion",
      provenance: "route",
      name: metadataSuggestion.name,
    });
  });

  it("publishes the open skill under the requested public slug", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ skill: { id: "skill-1", source: skill }, rendered: init.rendered, source: init.source }),
      )
      .mockResolvedValueOnce(Response.json({ publication: { id: "publication-1" } }, { status: 201 }));
    const workspace = createWorkspace(init, { fetch: fetchMock });

    await workspace.actions.importSkill("---\nname: inbox-triage\n---\nBody.");
    await workspace.actions.publish("ben", "inbox-triage");

    expect(fetchMock).toHaveBeenLastCalledWith("/api/publications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skillId: "skill-1", slug: { owner: "ben", name: "inbox-triage" } }),
    });
    expect(workspace.getSnapshot().status).toBe("Published to the Skill library.");
    expect(workspace.getSnapshot().entries.at(-1)?.label).toBe("Published at ben/inbox-triage.");
  });

  it("opens a saved skill: decodes the detail, re-renders the hero, returns to build mode", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ skill: savedSkill, versions: [] }))
      .mockResolvedValueOnce(Response.json({ branches: [] }));
    const workspace = createWorkspace(init, { fetch: fetchMock });

    await workspace.actions.openSkill("skill-1");

    const snapshot = workspace.getSnapshot();
    expect(fetchMock).toHaveBeenCalledWith("/api/skills/skill-1");
    expect(snapshot.current).toEqual(skill);
    expect(snapshot.currentSkillId).toBe("skill-1");
    expect(snapshot.lintSummary?.grade).toBe("B");
    expect(snapshot.heroDocs.rendered.title).toBe("inbox-triage");
    expect(snapshot.mode).toBe("build");
    expect(snapshot.status).toBe("Skill opened.");
    expect(snapshot.entries.map((e) => e.label)).toEqual(["Opened inbox-triage."]);
  });

  it("surfaces a decode failure as a status + error entry, not a crash", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ skill: { id: "broken" } }));
    const workspace = createWorkspace(init, { fetch: fetchMock });

    await workspace.actions.openSkill("broken");

    const snapshot = workspace.getSnapshot();
    expect(snapshot.status).toBe("Error: Skill returned an unexpected response.");
    expect(snapshot.entries.at(-1)?.tone).toBe("error");
    expect(snapshot.current).toEqual(skill);
  });

  it("lists saved skills as openable entries and reports server errors", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ skills: [{ id: "skill-1", name: "inbox-triage", description: "Sort mail." }] }),
      )
      .mockResolvedValueOnce(Response.json({ error: "database is down" }, { status: 500 }));
    const workspace = createWorkspace(init, { fetch: fetchMock });

    await workspace.actions.showSkills();
    expect(workspace.getSnapshot().status).toBe("Skills loaded.");
    expect(workspace.getSnapshot().entries[0]).toMatchObject({
      id: "skill-1",
      label: "inbox-triage - Sort mail.",
      actionLabel: "Open",
    });

    await workspace.actions.showSkills();
    expect(workspace.getSnapshot().status).toBe("database is down");
    expect(workspace.getSnapshot().entries[0]?.tone).toBe("error");
  });

  it("imports pasted SKILL.md as markdown and a GitHub URL as JSON", async () => {
    const importBody = {
      skill: { id: "skill-2", source: skill },
      rendered: init.rendered,
      source: init.source,
    };
    const fetchMock = vi.fn().mockResolvedValue(Response.json(importBody));
    const workspace = createWorkspace(init, { fetch: fetchMock });

    await workspace.actions.importSkill("---\nname: inbox-triage\n---\nBody.");
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/import",
      expect.objectContaining({ headers: { "Content-Type": "text/markdown; charset=utf-8" } }),
    );
    expect(workspace.getSnapshot().status).toBe("Import complete.");
    expect(workspace.getSnapshot().currentSkillId).toBe("skill-2");

    await workspace.actions.importSkill("https://github.com/acme/skills/tree/main/inbox");
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/import",
      expect.objectContaining({
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: "https://github.com/acme/skills/tree/main/inbox" }),
      }),
    );
  });

  it("keeps the import error message from the server", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ error: "Not a SKILL.md" }, { status: 422 }));
    const workspace = createWorkspace(init, { fetch: fetchMock });

    await workspace.actions.importSkill("not markdown");

    expect(workspace.getSnapshot().status).toBe("Not a SKILL.md");
    expect(workspace.getSnapshot().busy).toBe(false);
  });

  it("runs lint against the current skill and pins the breakdown summary to the hero chip", async () => {
    const breakdown = {
      summary: { score: 73, grade: "C", counts: { error: 0, warn: 2, info: 1 } },
      findings: [{ rule: "example", severity: "warn", message: "Add an example." }],
    };
    const fetchMock = vi.fn().mockResolvedValue(Response.json(breakdown));
    const workspace = createWorkspace(init, { fetch: fetchMock });

    await workspace.actions.selectLintSurface("breakdown");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/lint",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ skill, currentSkillId: undefined, branchId: undefined, surface: "breakdown" }),
      }),
    );
    const snapshot = workspace.getSnapshot();
    expect(snapshot.capability?.kind).toBe("lint-breakdown");
    expect(snapshot.lintSummary?.score).toBe(73);
    expect(snapshot.status).toBe("Quality ready.");
    expect(snapshot.lintBusy).toBe(false);
  });

  it("runs visualise and decodes the mermaid panel", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ mermaid: "flowchart TD\n  A --> B" }));
    const workspace = createWorkspace(init, { fetch: fetchMock });

    await workspace.actions.runTool("visualise");

    const snapshot = workspace.getSnapshot();
    expect(fetchMock).toHaveBeenCalledWith("/api/visualise", expect.objectContaining({ method: "POST" }));
    expect(snapshot.capability).toEqual({ kind: "visualise", mermaid: "flowchart TD\n  A --> B" });
    expect(snapshot.status).toBe("Visualise ready.");
    expect(snapshot.toolBusy).toBe(false);
  });

  it("maps evaluation error codes to friendly copy and clears the busy flag", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ error: "cap reached", code: "cap_reached" }, { status: 429 }));
    const workspace = createWorkspace(init, { fetch: fetchMock });

    await workspace.actions.runTool("triggering-eval");

    expect(workspace.getSnapshot().status).toBe("Triggering eval is not available on the free plan.");
    expect(workspace.getSnapshot().toolBusy).toBe(false);
  });

  it("consumes an evaluation stream: progress panel first, decoded artifact last", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      sseResponse([
        { event: "eval-progress", data: { message: "Building prompt battery." } },
        {
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
        },
        {
          event: "artifact",
          data: {
            surface: "insights",
            body: { verdict: "good", summary: "Fires correctly.", findings: [], watch: [] },
          },
        },
      ]),
    );
    const workspace = createWorkspace(init, { fetch: fetchMock });
    const observed: string[] = [];
    workspace.subscribe(() => {
      const capability = workspace.getSnapshot().capability;
      if (capability && !observed.includes(capability.kind)) observed.push(capability.kind);
    });

    await workspace.actions.runTool("triggering-eval");

    expect(observed).toEqual(["evaluation-progress", "insights"]);
    const snapshot = workspace.getSnapshot();
    expect(snapshot.capability).toMatchObject({ kind: "insights", insight: { summary: "Fires correctly." } });
    expect(snapshot.status).toBe("Triggering eval ready.");
  });

  it("clears the capability panel when the evaluation stream errors", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      sseResponse([
        { event: "eval-progress", data: { message: "Building prompt battery." } },
        { event: "error", data: { message: "model_unavailable", code: "model_unavailable" } },
      ]),
    );
    const workspace = createWorkspace(init, { fetch: fetchMock });

    await workspace.actions.runTool("triggering-eval");

    expect(workspace.getSnapshot().capability).toBeNull();
    expect(workspace.getSnapshot().status).toBe("No model is configured.");
  });

  it("streams a build turn: entries, hero re-render, checkpointed skill id", async () => {
    const written: SkillSource = {
      ...skill,
      frontmatter: { ...skill.frontmatter, name: "calendar-planner" },
    };
    const fetchMock = vi.fn().mockResolvedValue(
      sseResponse([
        { event: "text", data: { delta: "Drafting the skill." } },
        { event: "skill", data: { source: written } },
        { event: "skill-checkpoint", data: { skillId: "skill-9" } },
        { event: "done", data: { skillId: "skill-9", revision: 1 } },
      ]),
    );
    const workspace = createWorkspace(init, { fetch: fetchMock });

    await workspace.actions.send("Make a calendar planner");

    const snapshot = workspace.getSnapshot();
    expect(snapshot.entries.map((e) => e.label)).toEqual([
      "Make a calendar planner",
      "Drafting the skill.",
    ]);
    expect(snapshot.heroDocs.rendered.title).toBe("calendar-planner");
    expect(snapshot.currentSkillId).toBe("skill-9");
    expect(snapshot.status).toBe("Build complete.");
    expect(snapshot.busy).toBe(false);
  });

  it("auto-resubmits lint feedback once after a completed build", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        sseResponse([
          { event: "skill", data: { source: skill } },
          { event: "lint-feedback", data: { feedback: "Lint - Quality C 70/100\n\nWarnings:\n- Add an example." } },
          { event: "done", data: { skillId: "skill-1", revision: 1 } },
        ]),
      )
      .mockResolvedValueOnce(sseResponse([{ event: "done", data: { skillId: "skill-1", revision: 2 } }]));
    const workspace = createWorkspace(init, { fetch: fetchMock });

    await workspace.actions.send("Make a calendar planner");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const second = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)) as {
      messages: readonly { role: string; content: string }[];
    };
    expect(second.messages.at(-1)?.content).toContain("Lint - Quality C 70/100");
  });

  it("starts, promotes, and refuses drafts through the confirm edge", async () => {
    const fetchMock = vi
      .fn()
      // open the saved skill (+ its draft list + the version's safety rating)
      .mockResolvedValueOnce(Response.json({ skill: savedSkill, versions: [] }))
      .mockResolvedValueOnce(Response.json({ branches: [] }))
      .mockResolvedValueOnce(Response.json({ rating: null }))
      // start a draft (+ the draft head's rating + refreshed draft list)
      .mockResolvedValueOnce(
        Response.json({ branch: { id: "draft-1", source: skill, lintSummary: null } }),
      )
      .mockResolvedValueOnce(Response.json({ rating: null }))
      .mockResolvedValueOnce(
        Response.json({ branches: [{ id: "draft-1", isMain: false, status: "open", revision: 1 }] }),
      )
      // promote (+ refreshed draft list)
      .mockResolvedValueOnce(Response.json({ skill: { source: skill, lintSummary: null } }))
      .mockResolvedValueOnce(Response.json({ branches: [] }));
    const confirm = vi
      .fn()
      // Promote: yes, set as main — and skip the optional safety rating.
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);
    const workspace = createWorkspace(init, { fetch: fetchMock, confirm });

    await workspace.actions.openSkill("skill-1");
    await workspace.actions.startDraft();
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      "/api/skills/skill-1/branches",
      expect.objectContaining({ method: "POST" }),
    );
    expect(workspace.getSnapshot().branchId).toBe("draft-1");
    expect(workspace.getSnapshot().openDrafts).toHaveLength(1);
    expect(workspace.getSnapshot().status).toBe("Draft started. Your main version is unchanged.");

    await workspace.actions.promote();
    expect(fetchMock).toHaveBeenNthCalledWith(
      7,
      "/api/skills/skill-1/branches/draft-1/promote",
      expect.objectContaining({ method: "POST" }),
    );
    // Skipping the optional rating never reaches /api/safety-review with a POST.
    expect(
      fetchMock.mock.calls.filter(
        ([url, opts]) =>
          url === "/api/safety-review" &&
          (opts as RequestInit | undefined)?.method === "POST",
      ),
    ).toHaveLength(0);
    expect(workspace.getSnapshot().branchId).toBeNull();
    expect(workspace.getSnapshot().status).toBe("This draft is now your main version.");

    // A declined confirm never reaches the network.
    confirm.mockReturnValue(false);
    const calls = fetchMock.mock.calls.length;
    await workspace.actions.restoreVersion("skill-1", 1);
    expect(fetchMock.mock.calls).toHaveLength(calls);
  });

  it("runs the opt-in safety rating once and re-opens the stored rating for free", async () => {
    const ratingBody = {
      rating: {
        verdict: "passed",
        scores: [
          { class: "injection", score: 0.02, rationale: "No override language." },
          { class: "exfiltration", score: 0.05, rationale: "No secret collection." },
          { class: "deception", score: 0.01, rationale: "Clear purpose." },
        ],
        insight: { verdict: "good", summary: "Nothing risky found.", findings: [], watch: [] },
      },
    };
    const fetchMock = vi.fn().mockResolvedValue(Response.json(ratingBody));
    const workspace = createWorkspace(init, { fetch: fetchMock });

    await workspace.actions.runTool("safety-review");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/safety-review",
      expect.objectContaining({ method: "POST" }),
    );
    expect(workspace.getSnapshot().safetyRating?.verdict).toBe("passed");
    expect(workspace.getSnapshot().capability?.kind).toBe("safety-insights");
    expect(workspace.getSnapshot().status).toBe("Safety rating ready.");

    // A rated version never re-spends: the second click re-renders the stored
    // rating, and switching surfaces stays local.
    await workspace.actions.runTool("safety-review");
    workspace.actions.selectSafetySurface("breakdown");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(workspace.getSnapshot().capability?.kind).toBe("safety-breakdown");
  });

  it("offers the optional safety rating during promote and lets its verdict pause the promote", async () => {
    const needsReview = {
      rating: {
        verdict: "needs-review",
        scores: [
          { class: "injection", score: 0.5, rationale: "Broad override language." },
          { class: "exfiltration", score: 0.1, rationale: "No secret collection." },
          { class: "deception", score: 0.1, rationale: "Clear purpose." },
        ],
        insight: {
          verdict: "needs-attention",
          summary: "Injection needs a look.",
          findings: [],
          watch: [],
        },
      },
    };
    const fetchMock = vi
      .fn()
      // open the saved skill (+ draft list + rating)
      .mockResolvedValueOnce(Response.json({ skill: savedSkill, versions: [] }))
      .mockResolvedValueOnce(Response.json({ branches: [] }))
      .mockResolvedValueOnce(Response.json({ rating: null }))
      // start a draft (+ the draft head's rating + refreshed draft list)
      .mockResolvedValueOnce(
        Response.json({ branch: { id: "draft-1", source: skill, lintSummary: null } }),
      )
      .mockResolvedValueOnce(Response.json({ rating: null }))
      .mockResolvedValueOnce(
        Response.json({ branches: [{ id: "draft-1", isMain: false, status: "open", revision: 1 }] }),
      )
      // the accepted optional rating run
      .mockResolvedValueOnce(Response.json(needsReview));
    const confirm = vi
      .fn()
      .mockReturnValueOnce(true) // set as main?
      .mockReturnValueOnce(true) // run the optional rating first?
      .mockReturnValueOnce(false); // "needs review" — promote anyway? no
    const workspace = createWorkspace(init, { fetch: fetchMock, confirm });

    await workspace.actions.openSkill("skill-1");
    await workspace.actions.startDraft();
    await workspace.actions.promote();

    // The rating ran against the draft, promote never reached the network, and
    // the draft + its rating are still on the hero.
    expect(fetchMock).toHaveBeenNthCalledWith(
      7,
      "/api/safety-review",
      expect.objectContaining({ method: "POST" }),
    );
    const promoteCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes("/promote"),
    );
    expect(promoteCalls).toHaveLength(0);
    expect(workspace.getSnapshot().branchId).toBe("draft-1");
    expect(workspace.getSnapshot().safetyRating?.verdict).toBe("needs-review");
  });

  it("keeps checked equipment for the session and bundles contracts into the next test run", async () => {
    const contract = JSON.stringify({
      name: "send_invoice_reminder",
      description: "Send a payment reminder.",
      input: { type: "object" },
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ score: 92, grade: "A", summary: "Solid contract.", findings: [], watch: [] }),
      )
      .mockResolvedValueOnce(
        Response.json({ verdict: "good", summary: "Ran fine.", findings: [], watch: [] }),
      );
    const workspace = createWorkspace(init, { fetch: fetchMock });

    await workspace.actions.submitEquipment(contract);
    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/tool-contract", expect.anything());
    expect(workspace.getSnapshot().equipment.contracts).toHaveLength(1);
    expect(workspace.getSnapshot().capability?.kind).toBe("lint-insights");
    expect(workspace.getSnapshot().entries[0]?.label).toBe("Tool contract: send_invoice_reminder");

    await workspace.actions.runTool("test-run");
    const body = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)) as {
      toolContracts?: readonly string[];
    };
    expect(body.toolContracts).toEqual([contract]);

    // The entry's Remove action drops it from the session.
    workspace.getSnapshot().entries[0]?.onAction?.();
    expect(workspace.getSnapshot().equipment.contracts).toHaveLength(0);
  });

  it("routes a plain-language equipment message into the authoring loop and keeps the drafted schema", async () => {
    const schemaJson = JSON.stringify({
      title: "invoice-summary",
      type: "object",
      required: ["amount"],
      properties: { amount: { type: "number", description: "Total due in cents." } },
    });
    const fetchMock = vi
      .fn()
      // Turn 1: the authoring loop writes the schema (no lint findings).
      .mockResolvedValueOnce(
        sseResponse([
          { event: "text", data: { delta: "Drafting the invoice schema." } },
          { event: "response-schema", data: { source: { document: JSON.parse(schemaJson) as Record<string, unknown> } } },
          { event: "done", data: { finishReason: "stop" } },
        ]),
      )
      // The finished draft is quality-checked and kept like a pasted schema.
      .mockResolvedValueOnce(
        Response.json({ score: 95, grade: "A", summary: "Solid schema.", findings: [], watch: [] }),
      );
    const workspace = createWorkspace(init, { fetch: fetchMock });

    await workspace.actions.submitEquipment("A schema for my invoice summaries, just draft it");

    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/response-schema/build", expect.anything());
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/response-schema", expect.anything());
    const snapshot = workspace.getSnapshot();
    expect(snapshot.equipment.schemas).toHaveLength(1);
    expect(snapshot.equipment.schemas[0]?.name).toBe("invoice-summary");
    expect(snapshot.capability?.kind).toBe("lint-insights");
    expect(snapshot.status).toBe(
      'Response schema "invoice-summary" checked and kept for tool contracts to reference.',
    );
    expect(snapshot.entries.map((e) => e.label)).toEqual([
      "A schema for my invoice summaries, just draft it",
      "Drafting the invoice schema.",
      'Response schema "invoice-summary" checked and kept for tool contracts to reference.',
    ]);
  });

  it("routes a plain-language tool-contract message into its authoring loop and keeps the drafted contract", async () => {
    const contractSource = {
      name: "send_invoice_reminder",
      description: "Send a payment reminder email for one overdue invoice.",
      input: {
        kind: "inline",
        schema: {
          type: "object",
          required: ["invoiceId"],
          properties: { invoiceId: { type: "string", description: "The invoice id." } },
        },
      },
      output: { kind: "schema-ref", ref: "invoice-summary" },
      examples: [{ input: { invoiceId: "INV-1" } }],
      failureModes: ["invoice not found"],
      safetyNotes: ["Confirm before sending email."],
      extra: {},
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        sseResponse([
          { event: "text", data: { delta: "Drafting the tool contract." } },
          { event: "tool-contract", data: { source: contractSource } },
          { event: "done", data: { finishReason: "stop" } },
        ]),
      )
      .mockResolvedValueOnce(
        Response.json({ score: 94, grade: "A", summary: "Solid contract.", findings: [], watch: [] }),
      );
    const workspace = createWorkspace(init, { fetch: fetchMock });

    await workspace.actions.submitEquipment("A tool contract for invoice reminders, just draft it");

    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/tool-contract/build", expect.anything());
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/tool-contract", expect.anything());
    const snapshot = workspace.getSnapshot();
    expect(snapshot.equipment.contracts).toHaveLength(1);
    expect(snapshot.equipment.contracts[0]?.name).toBe("send_invoice_reminder");
    expect(snapshot.equipment.contracts[0]?.raw).toContain('"$ref": "invoice-summary"');
    expect(snapshot.status).toBe(
      'Tool contract "send_invoice_reminder" checked — it runs with your next test run.',
    );
    expect(snapshot.entries.map((e) => e.label)).toEqual([
      "A tool contract for invoice reminders, just draft it",
      "Drafting the tool contract.",
      'Tool contract "send_invoice_reminder" checked — it runs with your next test run.',
    ]);
  });

  it("applies streamed schema edits and hands lint feedback back as the next authoring turn", async () => {
    const draft = {
      title: "invoice-summary",
      type: "object",
      properties: { amount: { type: "number" } },
    };
    const fetchMock = vi
      .fn()
      // Turn 1: write with lint findings pending.
      .mockResolvedValueOnce(
        sseResponse([
          { event: "response-schema", data: { source: { document: draft } } },
          { event: "lint-feedback", data: { feedback: "Lint - Quality B 80/100\n\nName every field." } },
          { event: "done", data: { finishReason: "stop" } },
        ]),
      )
      // Turn 2 (auto lint feedback): the loop patches the draft with an edit.
      .mockResolvedValueOnce(
        sseResponse([
          { event: "response-schema-edit", data: { oldStr: '"type": "number"', newStr: '"type": "number",\n        "description": "Total due in cents."' } },
          { event: "done", data: { finishReason: "stop" } },
        ]),
      )
      // The finished draft is checked and kept.
      .mockResolvedValueOnce(
        Response.json({ score: 98, grade: "A", summary: "Solid schema.", findings: [], watch: [] }),
      );
    const workspace = createWorkspace(init, { fetch: fetchMock });

    await workspace.actions.submitEquipment("A schema for my invoice summaries");

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const secondTurnBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)) as {
      messages: readonly { content: string }[];
      current?: string;
    };
    expect(secondTurnBody.messages.at(-1)?.content).toContain("Lint - Quality");
    expect(secondTurnBody.current).toContain('"title": "invoice-summary"');

    const keptRaw = workspace.getSnapshot().equipment.schemas[0]?.raw ?? "";
    expect(keptRaw).toContain("Total due in cents.");
  });

  it("loads history with restorable versions and run entries", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ skill: savedSkill, versions: [] }))
      .mockResolvedValueOnce(Response.json({ branches: [] }))
      .mockResolvedValueOnce(Response.json({ rating: null }))
      .mockResolvedValueOnce(
        Response.json({
          testRuns: [{ status: "completed", scenario: { prompt: "Triage the inbox." } }],
          evalRuns: [{ status: "failed", result: { insight: { summary: "Fires too broadly." } } }],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          skill: savedSkill,
          versions: [
            { id: "v1", revision: 1, source: skill, lintSummary: null },
            { id: "v2", revision: 2, source: skill, lintSummary: null },
          ],
        }),
      );
    const workspace = createWorkspace(init, { fetch: fetchMock });

    await workspace.actions.openSkill("skill-1");
    await workspace.actions.showHistory();

    const snapshot = workspace.getSnapshot();
    expect(snapshot.mode).toBe("history");
    expect(snapshot.status).toBe("History loaded.");
    const labels = snapshot.entries.map((e) => e.label);
    expect(labels).toEqual([
      "Revision 1: Sort unread mail into useful buckets.",
      "Revision 2 (current): Sort unread mail into useful buckets.",
      "Triggering eval failed: Fires too broadly.",
      "Test run completed: Triage the inbox.",
    ]);
    expect(snapshot.entries[0]?.onAction).toBeDefined();
    expect(snapshot.entries[1]?.onAction).toBeUndefined();
  });

  it("loads Templates from the Skill library feed and exposes install-boundary details", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        surface: "templates",
        entries: [
          {
            name: "inbox-triage",
            owner: "ben",
            slug: "ben/inbox-triage",
            tier: "reviewed",
            trustLabel: "reviewed skill - human-reviewed",
            safety: { status: "safety-badge", label: "safety badge", ratingId: "rating-1" },
            surfaced: true,
            contentHash: "sha256:reviewed",
            description: "Triage unread email into priority buckets.",
            category: "email",
            tags: ["triage", "inbox"],
            source: { type: "git", ref: "HEAD", path: "skills/ben/inbox-triage" },
          },
        ],
      }),
    );
    const workspace = createWorkspace(init, { fetch: fetchMock });

    await workspace.actions.showTemplates();

    expect(fetchMock).toHaveBeenCalledWith("/api/skill-library?surface=templates");
    expect(workspace.getSnapshot().mode).toBe("templates");
    expect(workspace.getSnapshot().status).toBe("Templates loaded.");
    expect(workspace.getSnapshot().entries[0]).toMatchObject({
      id: "template-ben/inbox-triage",
      actionLabel: "Open details",
    });
    expect(workspace.getSnapshot().entries[0]?.label).toContain("safety badge");
    expect(workspace.getSnapshot().entries[0]?.label).toContain("reviewed skill - human-reviewed");
    expect(workspace.getSnapshot().entries[0]?.label).toContain("Hash sha256:reviewed");
    expect(workspace.getSnapshot().entries[0]?.label).toContain("Presentation is guidance, not a guarantee.");

    await workspace.actions.showTemplates("inbox");
    expect(fetchMock).toHaveBeenLastCalledWith("/api/skill-library?surface=templates&q=inbox");

    await workspace.actions.showTemplates("ben/published-helper");
    expect(fetchMock).toHaveBeenLastCalledWith("/api/skill-library?slug=ben%2Fpublished-helper");
  });

  it("asks to open a saved skill before showing history", async () => {
    const fetchMock = vi.fn();
    const workspace = createWorkspace(init, { fetch: fetchMock });

    await workspace.actions.showHistory();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(workspace.getSnapshot().status).toBe("Open a saved skill first.");
  });
});
