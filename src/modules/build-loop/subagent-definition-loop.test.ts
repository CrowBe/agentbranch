import { describe, expect, it } from "vitest";
import type { AgentStreamPart, ModelGateway } from "@/modules/model-gateway";
import { domainError, err, ok, UserId } from "@/shared";
import { runSubagentDefinitionLoop } from "./subagent-definition-loop";
import { createSubagentDefinitionTools } from "./subagent-definition-tools";

const raw = `---
name: inbox-risk-reviewer
description: Review ambiguous email classifications when escalation is required.
tools: []
---

Review classifications, explain escalation reasons, and return a structured recommendation.`;

function gateway(parts: readonly AgentStreamPart[]): ModelGateway {
  return {
    hasModel: true,
    classify: async () => err(domainError("model_unavailable", "n/a")),
    runAgent: async () => err(domainError("model_unavailable", "n/a")),
    generate: async () => err(domainError("model_unavailable", "n/a")),
    streamAgent: async () => ok((async function* () { yield* parts; })()),
  };
}

describe("subagent definition authoring", () => {
  it("rejects edit-before-write and permits recovery with a write", async () => {
    const tools = createSubagentDefinitionTools();
    const edit = tools.find((tool) => tool.name === "edit_subagent_definition")!;
    const write = tools.find((tool) => tool.name === "write_subagent_definition")!;

    expect(await edit.handler({ oldStr: "Review", newStr: "Inspect" })).toMatchObject({
      ok: false,
      error: expect.stringContaining("write_subagent_definition"),
    });
    expect(await write.handler({ content: raw })).toMatchObject({ ok: true });
    expect(await edit.handler({ oldStr: "Review classifications", newStr: "Inspect classifications" })).toMatchObject({ ok: true });
  });

  it("emits an explicit terminal failure when a draft mutation produced no draft", async () => {
    const events = [];
    for await (const event of runSubagentDefinitionLoop(
      { messages: [{ role: "user", content: "Just draft it" }] },
      gateway([
        { kind: "tool-call", tool: "edit_subagent_definition" },
        { kind: "tool-result", tool: "edit_subagent_definition", output: { ok: false, error: "No draft exists." } },
        { kind: "finish", finishReason: "stop" },
      ]),
      UserId("u1"),
    )) events.push(event);

    expect(events.map((event) => event.event)).toEqual(["tool", "tool", "error", "done"]);
    expect(events[2]?.data).toHaveProperty("message", "No subagent definition was created. Retry to create a new draft.");
  });
});
