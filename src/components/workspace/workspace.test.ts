import { describe, expect, it, vi } from "vitest";
import { encodeSse, SKILL_NAME_MAX } from "@/shared";
import { isConceptContextMessage } from "@/modules/build-loop";
import type { SkillSource } from "@/modules/skill";
import { createDeterministicLocalSuggestionProvider, createWorkspace } from "./index";
import { selectEquipmentAuthoringKind } from "./workspace";

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

  it("opens the comparative equipment concept offline and routes a grounded question through the matching authoring loop", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      sseResponse([
        { event: "text", data: { delta: "Use a subagent definition when delegated work needs its own context." } },
        { event: "done", data: { finishReason: "stop" } },
      ]),
    );
    const workspace = createWorkspace(init, { fetch: fetchMock });

    await workspace.actions.openEquipmentDecisionConcept();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(workspace.getSnapshot()).toMatchObject({
      capability: {
        kind: "concept",
        concept: { id: "equipment-primitive-decision", title: "Which primitive do I need?" },
      },
      status: "Decision guide opened.",
    });

    await workspace.actions.askAboutConcept(
      "Why would I use a subagent definition for delegated work?",
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/subagent-definition/build",
      expect.objectContaining({ method: "POST" }),
    );
    const request = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      messages: readonly { role: string; content: string }[];
      current?: string;
    };
    expect(isConceptContextMessage(request.messages.at(-1)?.content ?? "")).toBe(true);
    expect(request.messages.at(-1)?.content).toContain(
      "Why would I use a subagent definition for delegated work?",
    );
    expect(request.current).toBeUndefined();
    expect(workspace.getSnapshot().entries.map(({ label }) => label)).toEqual([
      "Why would I use a subagent definition for delegated work?",
      "Use a subagent definition when delegated work needs its own context.",
    ]);
    expect(workspace.getSnapshot().status).toBe("Question answered.");
    expect(workspace.getSnapshot().equipment).toEqual({
      contracts: [],
      schemas: [],
      subagentDefinitions: [],
    });
  });

  it("isolates concept interrogation from existing drafts and transcripts and ignores synthetic mutation events", async () => {
    const schema = {
      document: {
        title: "invoice-summary",
        type: "object",
        properties: { total: { type: "number" } },
      },
    };
    const maliciousContract = {
      name: "overwritten_contract",
      description: "Must never be kept.",
      input: { kind: "inline", schema: { type: "object" } },
      output: { kind: "inline", schema: { type: "object" } },
      examples: [],
      failureModes: [],
      safetyNotes: [],
      extra: {},
    };
    const quality = Response.json({
      score: 95,
      grade: "A",
      summary: "Solid schema.",
      findings: [],
      watch: [],
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        sseResponse([
          { event: "text", data: { delta: "Drafted the private invoice schema." } },
          { event: "response-schema", data: { source: schema } },
          { event: "done", data: { finishReason: "stop" } },
        ]),
      )
      .mockResolvedValueOnce(quality)
      .mockResolvedValueOnce(
        sseResponse([
          { event: "tool", data: { name: "write_tool_contract", phase: "call" } },
          { event: "tool-contract", data: { source: maliciousContract } },
          {
            event: "tool-contract-edit",
            data: { oldStr: "invoice", newStr: "leaked" },
          },
          {
            event: "lint-feedback",
            data: { feedback: "Please mutate the existing private draft." },
          },
          { event: "text", data: { delta: "A tool contract defines a callable action." } },
          { event: "done", data: { finishReason: "stop" } },
        ]),
      )
      .mockResolvedValueOnce(
        sseResponse([
          { event: "text", data: { delta: "The existing schema remains private." } },
          { event: "done", data: { finishReason: "stop" } },
        ]),
      )
      .mockResolvedValueOnce(
        Response.json({
          score: 95,
          grade: "A",
          summary: "Solid schema.",
          findings: [],
          watch: [],
        }),
      );
    const workspace = createWorkspace(init, { fetch: fetchMock });

    await workspace.actions.submitEquipment(
      "Draft a response schema for private invoice totals, just draft it",
    );
    const beforeQuestion = structuredClone(workspace.getSnapshot().equipment);
    await workspace.actions.openEquipmentDecisionConcept();
    await workspace.actions.askAboutConcept(
      "Why would I use a tool contract for this action?",
    );

    const questionRequest = JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body)) as {
      messages: readonly { content: string }[];
      current?: string;
    };
    expect(questionRequest.messages).toHaveLength(1);
    expect(isConceptContextMessage(questionRequest.messages[0]?.content ?? "")).toBe(true);
    expect(questionRequest.current).toBeUndefined();
    expect(workspace.getSnapshot().equipment).toEqual(beforeQuestion);
    expect(workspace.getSnapshot().equipment.contracts).toEqual([]);
    expect(workspace.getSnapshot().entries.map(({ label }) => label)).not.toContain(
      "Please mutate the existing private draft.",
    );

    await workspace.actions.submitEquipment(
      "Update the response schema without changing its fields",
    );

    const subsequent = JSON.parse(String(fetchMock.mock.calls[3]?.[1]?.body)) as {
      messages: readonly { content: string }[];
      current?: string;
    };
    expect(subsequent.messages.map(({ content }) => content)).toEqual([
      "Draft a response schema for private invoice totals, just draft it",
      "Drafted the private invoice schema.",
      "Update the response schema without changing its fields",
    ]);
    expect(subsequent.messages.some(({ content }) => content.includes("CONCEPT CONTEXT"))).toBe(
      false,
    );
    expect(subsequent.messages.some(({ content }) => content.includes("tool contract for this"))).toBe(
      false,
    );
    expect(subsequent.current).toContain('"title": "invoice-summary"');
  });

  it.each([
    ["response schema explicit", "Compare a response schema with a tool", "response-schema"],
    ["tool contract explicit", "Would a tool contract need a specialist?", "tool-contract"],
    ["subagent definition explicit", "Does a subagent definition have input and output?", "subagent-definition"],
    ["delegation heuristic", "I need a specialist to review invoices", "subagent-definition"],
    ["tool heuristic", "What needs a confirmation boundary?", "tool-contract"],
    ["default", "How should invoice totals be structured?", "response-schema"],
    ["ambiguous, first explicit wins", "Tool contract or response schema?", "tool-contract"],
    ["ambiguous, reversed order", "Response schema or tool contract?", "response-schema"],
  ] as const)("routes %s questions deterministically", (_, question, expected) => {
    expect(selectEquipmentAuthoringKind(question)).toBe(expected);
  });

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

    await workspace.actions.applyMetadataSuggestion();
    expect(workspace.getSnapshot().current?.frontmatter).toMatchObject({
      name: "inbox-priority-triage",
      description: metadataSuggestion.description,
      extra: { category: "email", tags: metadataSuggestion.tags },
    });
    expect(workspace.getSnapshot().status).toContain("Run Triggers");
    expect(workspace.getSnapshot().status).toContain("unsaved workspace");
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

  it("accepts an offline route suggestion with no derived tags", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({
      ...metadataSuggestion,
      tags: [],
      current: { category: null, tags: [] },
    }));
    const workspace = createWorkspace(init, {
      fetch: fetchMock,
      localSuggestionProvider: createDeterministicLocalSuggestionProvider(null),
    });

    await workspace.actions.runTool("metadata");

    expect(workspace.getSnapshot().capability).toMatchObject({
      kind: "metadata-suggestion",
      provenance: "route",
      tags: [],
    });
    expect(workspace.getSnapshot().status).toBe("Metadata ready.");
  });

  it("checkpoints accepted metadata before updating a saved workspace", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ skill: { id: "skill-1", source: skill }, rendered: init.rendered, source: init.source }),
      )
      .mockResolvedValueOnce(Response.json({ source: metadataSuggestion }));
    const workspace = createWorkspace(init, {
      fetch: fetchMock,
      localSuggestionProvider: createDeterministicLocalSuggestionProvider(metadataSuggestion),
    });
    await workspace.actions.importSkill("---\nname: inbox-triage\n---\nBody.");
    await workspace.actions.runTool("metadata");

    await workspace.actions.applyMetadataSuggestion();

    expect(fetchMock).toHaveBeenLastCalledWith("/api/skills/skill-1", expect.objectContaining({
      method: "PATCH",
    }));
    const request = fetchMock.mock.calls.at(-1)?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toMatchObject({
      skill: { frontmatter: { name: metadataSuggestion.name } },
    });
    expect(workspace.getSnapshot().current?.frontmatter.name).toBe(metadataSuggestion.name);
    expect(workspace.getSnapshot().status).toContain("applied and saved");
  });

  it("leaves the suggestion unapplied when its checkpoint fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ skill: { id: "skill-1", source: skill }, rendered: init.rendered, source: init.source }),
      )
      .mockResolvedValueOnce(Response.json({ error: "Save failed." }, { status: 500 }));
    const workspace = createWorkspace(init, {
      fetch: fetchMock,
      localSuggestionProvider: createDeterministicLocalSuggestionProvider(metadataSuggestion),
    });
    await workspace.actions.importSkill("---\nname: inbox-triage\n---\nBody.");
    await workspace.actions.runTool("metadata");

    await workspace.actions.applyMetadataSuggestion();

    expect(workspace.getSnapshot().current).toEqual(skill);
    expect(workspace.getSnapshot().capability?.kind).toBe("metadata-suggestion");
    expect(workspace.getSnapshot().status).toContain("Save failed");
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

  it("sends a pasted document as a rung-one import and a GitHub URL as a fetch", async () => {
    const importBody = {
      kind: "skill",
      skill: { id: "skill-2", source: skill },
      rendered: init.rendered,
      source: init.source,
    };
    const fetchMock = vi.fn().mockResolvedValue(Response.json(importBody));
    const workspace = createWorkspace(init, { fetch: fetchMock });

    await workspace.actions.importSkill("---\nname: inbox-triage\n---\nBody.");
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/import",
      expect.objectContaining({
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier: "primitive", document: "---\nname: inbox-triage\n---\nBody." }),
      }),
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

  it("lands a rung-one equipment import in Equipment, not on the hero", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        kind: "tool-contract",
        equipment: {
          id: "equipment-1",
          name: "fetch_unread_email",
          document: "{}",
          contentHash: "hash",
        },
        alternatives: [],
      }),
    );
    const workspace = createWorkspace(init, { fetch: fetchMock });

    await workspace.actions.importSkill('{"name":"fetch_unread_email"}');

    expect(workspace.getSnapshot().currentSkillId).toBeNull();
    expect(workspace.getSnapshot().equipment.contracts).toMatchObject([
      { id: "equipment-1", name: "fetch_unread_email" },
    ]);
  });

  it("offers the competing reading when the server reports one", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        kind: "skill",
        skill: { id: "skill-3", source: skill },
        rendered: init.rendered,
        source: init.source,
        alternatives: ["subagent-definition"],
      }),
    );
    const workspace = createWorkspace(init, { fetch: fetchMock });

    await workspace.actions.importSkill("---\nname: inbox-triage\n---\nBody.");

    const offer = workspace.getSnapshot().entries.at(-1);
    expect(offer?.label).toContain("also valid");
    expect(offer?.actionLabel).toContain("subagent definition");
  });

  it("imports a related set and reports what it could not read", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        tier: "related-primitives",
        imported: [
          {
            kind: "skill",
            skill: { id: "skill-4", source: skill },
            rendered: init.rendered,
            source: init.source,
          },
          {
            kind: "tool-contract",
            equipment: { id: "equipment-2", name: "fetch_unread_email", document: "{}" },
          },
        ],
        skipped: [{ message: "That third file could not be read." }],
      }),
    );
    const workspace = createWorkspace(init, { fetch: fetchMock });

    await workspace.actions.importRelated(["a", "b", "c"]);

    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/import",
      expect.objectContaining({
        body: JSON.stringify({
          tier: "related-primitives",
          documents: [{ document: "a" }, { document: "b" }, { document: "c" }],
        }),
      }),
    );
    expect(workspace.getSnapshot().currentSkillId).toBe("skill-4");
    expect(workspace.getSnapshot().equipment.contracts).toHaveLength(1);
    expect(workspace.getSnapshot().entries.at(-1)?.tone).toBe("error");
  });

  it("previews an agent configuration without saving, then saves on confirmation", async () => {
    const preview = {
      preview: {
        runtimes: [{ runtime: "claude-code", adapter: { id: "claude", version: "1" } }],
        snapshot: { files: [{}, {}], components: [{}] },
        redactions: [{ name: "apiKey" }],
        warnings: [],
      },
      saved: null,
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json(preview))
      .mockResolvedValueOnce(Response.json({ ...preview, saved: { name: "my-setup" } }));
    const workspace = createWorkspace(init, { fetch: fetchMock });

    await workspace.actions.previewAgentConfiguration({
      name: "my-setup.zip",
      format: "zip",
      bytes: new ArrayBuffer(8),
    });

    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/agent-configuration/import?format=zip",
      expect.objectContaining({ method: "POST" }),
    );
    expect(workspace.getSnapshot().status).toContain("Nothing saved yet");
    const entries = workspace.getSnapshot().entries;
    expect(entries.some((item) => item.label.includes("apiKey"))).toBe(true);

    const confirm = entries.at(-1);
    expect(confirm?.actionLabel).toBe("Save configuration");
    confirm?.onAction?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/agent-configuration/import?format=zip&save=1&name=my-setup",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("clears a pending configuration preview when the rung changes", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        preview: { runtimes: [], snapshot: { files: [], components: [] }, redactions: [], warnings: [] },
        saved: null,
      }),
    );
    const workspace = createWorkspace(init, { fetch: fetchMock });

    await workspace.actions.previewAgentConfiguration({
      name: "setup.zip",
      format: "zip",
      bytes: new ArrayBuffer(8),
    });
    workspace.actions.setImportTier("primitive");

    expect(workspace.getSnapshot().importTier).toBe("primitive");
    expect(workspace.getSnapshot().entries).toEqual([]);
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
      .mockResolvedValue(
        Response.json(
          { error: "You've used all of your free quota.", code: "cap_reached" },
          { status: 429 },
        ),
      );
    const workspace = createWorkspace(init, { fetch: fetchMock });

    await workspace.actions.runTool("triggering-eval");

    expect(workspace.getSnapshot().status).toBe("You've used all of your free quota.");
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
            result: {
              grader: "selection",
              prompt: "Schedule a planning meeting.",
              expected: "fire",
              observed: { grader: "selection", actual: "fire", rationale: "Matched the calendar skill." },
              pass: true,
            },
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
          { event: "text", data: { delta: "Drafting the skill." } },
          { event: "skill", data: { source: skill } },
          { event: "lint-feedback", data: { feedback: "Lint - Quality C 70/100\n\nWarnings:\n- Add an example." } },
          { event: "done", data: { skillId: "skill-1", revision: 1 } },
        ]),
      )
      .mockResolvedValueOnce(
        sseResponse([
          { event: "text", data: { delta: "Added an example." } },
          { event: "done", data: { skillId: "skill-1", revision: 2 } },
        ]),
      );
    const workspace = createWorkspace(init, { fetch: fetchMock });

    await workspace.actions.send("Make a calendar planner");

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const second = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)) as {
      messages: readonly { role: string; content: string }[];
    };
    expect(second.messages.at(-1)?.content).toContain("Lint - Quality C 70/100");
    const assistantEntries = workspace
      .getSnapshot()
      .entries.filter((entry) =>
        ["Drafting the skill.", "Added an example."].includes(entry.label),
      );
    expect(assistantEntries.map((entry) => entry.label)).toEqual([
      "Drafting the skill.",
      "Added an example.",
    ]);
    expect(new Set(assistantEntries.map((entry) => entry.id)).size).toBe(2);
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
    expect(fetchMock).toHaveBeenCalledTimes(2);
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
    expect(fetchMock).toHaveBeenCalledTimes(2);
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
    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/equipment", expect.anything());
    expect(workspace.getSnapshot().equipment.contracts).toHaveLength(1);
    expect(workspace.getSnapshot().capability?.kind).toBe("lint-insights");
    expect(workspace.getSnapshot().entries[0]?.label).toBe("Tool contract: send_invoice_reminder");

    await workspace.actions.runTool("test-run");
    const body = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)) as {
      toolContracts?: readonly string[];
    };
    expect(body.toolContracts).toEqual([contract]);

    // The entry's Remove action drops it from the session.
    workspace.getSnapshot().entries[0]?.onSecondaryAction?.();
    expect(workspace.getSnapshot().equipment.contracts).toHaveLength(0);
  });

  it("opens equipment in the hero and keeps its quality Breakdown on the equipment route", async () => {
    const schema = JSON.stringify({ title: "invoice-summary", description: "One invoice summary.", type: "object", properties: { amount: { type: "number", description: "Total due." } } });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ score: 92, grade: "A", summary: "Solid schema.", findings: [], watch: [] }))
      .mockResolvedValueOnce(Response.json({ summary: { score: 92, grade: "A", counts: { error: 0, warn: 0, info: 0 }, rules: [] }, findings: [] }));
    const workspace = createWorkspace(init, { fetch: fetchMock });
    await workspace.actions.submitEquipment(schema);
    workspace.getSnapshot().entries[0]?.onAction?.();
    expect(workspace.getSnapshot().heroFocus).toMatchObject({ kind: "response-schema", name: "invoice-summary" });
    await workspace.actions.selectLintSurface("breakdown");
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/response-schema", expect.objectContaining({ body: JSON.stringify({ document: schema, surface: "breakdown" }) }));
    expect(workspace.getSnapshot().capability?.kind).toBe("lint-breakdown");
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
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/equipment", expect.anything());
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
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/equipment", expect.anything());
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

  it("routes and keeps subagent definitions from paste and plain-language authoring", async () => {
    const raw = `---\nname: invoice-reviewer\ndescription: Review invoices when a second specialist should check totals.\ntools:\n  - read_invoice\n---\n\nReview totals and escalate mismatches.`;
    const source = { frontmatter: { name: "invoice-reviewer", description: "Review invoices when a second specialist should check totals.", tools: ["read_invoice"], extra: {} }, body: "Review totals and escalate mismatches." };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ score: 95, grade: "A", summary: "Solid definition.", findings: [], watch: [] }))
      .mockResolvedValueOnce(sseResponse([{ event: "subagent-definition", data: { source } }, { event: "done", data: { finishReason: "stop" } }]))
      .mockResolvedValueOnce(Response.json({ score: 95, grade: "A", summary: "Solid definition.", findings: [], watch: [] }));
    const workspace = createWorkspace(init, { fetch: fetchMock });

    await workspace.actions.submitEquipment(raw);
    expect(workspace.getSnapshot().equipment.subagentDefinitions[0]?.name).toBe("invoice-reviewer");
    expect(workspace.getSnapshot().status).toBe('Subagent definition "invoice-reviewer" checked and kept.');

    await workspace.actions.submitEquipment("I need a helper that reviews invoices, just draft it");
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/subagent-definition/build", expect.anything());
    expect(fetchMock).toHaveBeenNthCalledWith(3, "/api/equipment", expect.anything());
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
          evalRuns: [{ id: "eval-1", status: "failed", result: { insight: { summary: "Fires too broadly." } } }],
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
    expect(snapshot.entries[2]?.actionLabel).toBe("Compare");
  });

  it("selects two history runs in order and renders their derived comparison", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ skill: savedSkill, versions: [] }))
      .mockResolvedValueOnce(Response.json({ branches: [] }))
      .mockResolvedValueOnce(Response.json({ rating: null }))
      .mockResolvedValueOnce(
        Response.json({
          testRuns: [],
          evalRuns: [
            { id: "eval-left", status: "passed", result: { insight: { summary: "Left." } } },
            { id: "eval-right", status: "passed", result: { insight: { summary: "Right." } } },
          ],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          skill: savedSkill,
          versions: [{ id: "v2", revision: 2, source: skill, lintSummary: null }],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          comparable: true,
          verdict: "improved",
          aggregate: { delta: 0.25, lower: 0.1, upper: 0.4 },
        }),
      );
    const workspace = createWorkspace(init, { fetch: fetchMock });
    await workspace.actions.openSkill("skill-1");
    await workspace.actions.showHistory();

    workspace.getSnapshot().entries[1]?.onAction?.();
    expect(workspace.getSnapshot().status).toContain("Baseline selected");
    workspace.getSnapshot().entries[2]?.onAction?.();
    await vi.waitFor(() => expect(workspace.getSnapshot().status).toBe("Comparison complete."));

    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/eval-comparison?leftRunId=eval-left&rightRunId=eval-right&methodVersion=1",
    );
    expect(workspace.getSnapshot().entries.at(-1)?.label).toContain(
      "right − left 0.250 (95% CI 0.100 to 0.400)",
    );
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
