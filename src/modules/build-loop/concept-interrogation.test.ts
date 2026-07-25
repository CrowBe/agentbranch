import { describe, expect, it } from "vitest";
import type {
  AgentStreamPart,
  ModelGateway,
  StreamAgentInput,
} from "@/modules/model-gateway";
import { conceptLibrary } from "@/modules/concept-library";
import { domainError, err, ok, UserId } from "@/shared";
import { runBuildLoop } from "./build-loop";
import { isConceptContextMessage } from "./concept-context";
import { formatConceptContext } from "./feedback-formatters";
import { runResponseSchemaLoop } from "./response-schema-loop";
import { RESPONSE_SCHEMA_AUTHORING_PROMPT } from "./response-schema-prompt";
import { runSubagentDefinitionLoop } from "./subagent-definition-loop";
import { SUBAGENT_DEFINITION_AUTHORING_PROMPT } from "./subagent-definition-prompt";
import { BUILD_LOOP_SYSTEM_PROMPT } from "./system-prompt";
import { runToolContractLoop } from "./tool-contract-loop";
import { TOOL_CONTRACT_AUTHORING_PROMPT } from "./tool-contract-prompt";

const userId = UserId("concept-user");
const question = "Which primitive gives a specialist its own context?";
const message = formatConceptContext({
  concept: conceptLibrary.find((concept) => concept.id === "equipment-primitive-decision")!,
  question,
  glossary: {
    Skill: "Reusable instructions for a kind of work.",
    "Response schema": "The structured shape of a result.",
    "Tool contract": "A typed action an agent can call.",
    "Subagent definition": "The role and boundaries for delegated specialist work.",
  },
});

function promptContent(prompt: string | { readonly content: string }): string {
  return typeof prompt === "string" ? prompt : prompt.content;
}

function capturingGateway(seen: StreamAgentInput[]): ModelGateway {
  return {
    hasModel: true,
    classify: async () => err(domainError("model_unavailable", "unused")),
    runAgent: async () => err(domainError("model_unavailable", "unused")),
    generate: async () => err(domainError("model_unavailable", "unused")),
    streamAgent: async (input) => {
      seen.push(input);
      return ok(
        (async function* (): AsyncGenerator<AgentStreamPart> {
          yield { kind: "text", delta: "Use a subagent definition." };
          yield { kind: "finish", finishReason: "stop" };
        })(),
      );
    },
  };
}

async function eventNames(
  stream: AsyncGenerator<{ readonly event: string }>,
): Promise<readonly string[]> {
  const names: string[] = [];
  for await (const event of stream) names.push(event.event);
  return names;
}

describe("concept interrogation through authoring loops", () => {
  it("gives every prompt the same grounded, answer-only and no-mutation contract", () => {
    const prompts = [
      promptContent(BUILD_LOOP_SYSTEM_PROMPT),
      promptContent(RESPONSE_SCHEMA_AUTHORING_PROMPT),
      promptContent(TOOL_CONTRACT_AUTHORING_PROMPT),
      promptContent(SUBAGENT_DEFINITION_AUTHORING_PROMPT),
    ];

    for (const prompt of prompts) {
      expect(prompt).toContain("[BEGIN AGENTBRANCH CONCEPT CONTEXT v1]");
      expect(prompt).toContain("quoted, reviewed evidence");
      expect(prompt).toContain("start the requirements interview");
      expect(prompt).toContain("reviewed concept does not cover it");
      expect(prompt).toContain("Do not revise");
    }
    expect(prompts[0]).toContain("write_skill or edit_skill");
    expect(prompts[1]).toContain("write_response_schema or edit_response_schema");
    expect(prompts[2]).toContain("write_tool_contract or edit_tool_contract");
    expect(prompts[3]).toContain(
      "write_subagent_definition or edit_subagent_definition",
    );
  });

  it("passes the seeded user message unchanged through every loop without an artifact event", async () => {
    const seen: StreamAgentInput[] = [];
    const gateway = capturingGateway(seen);
    const streams = [
      runBuildLoop({ messages: [{ role: "user", content: message }] }, gateway, userId),
      runResponseSchemaLoop(
        { messages: [{ role: "user", content: message }] },
        gateway,
        userId,
      ),
      runToolContractLoop(
        { messages: [{ role: "user", content: message }] },
        gateway,
        userId,
      ),
      runSubagentDefinitionLoop(
        { messages: [{ role: "user", content: message }] },
        gateway,
        userId,
      ),
    ];

    for (const stream of streams) {
      expect(await eventNames(stream)).toEqual(["text", "done"]);
    }
    expect(seen).toHaveLength(4);
    for (const input of seen) {
      expect(input.messages.at(-1)).toMatchObject({
        role: "user",
        content: message,
      });
      expect(input.tools).toEqual([]);
    }
  });

  it("retains each loop's normal authoring tools for non-concept turns", async () => {
    const seen: StreamAgentInput[] = [];
    const gateway = capturingGateway(seen);
    const normal = "Draft this artifact.";
    const streams = [
      runBuildLoop({ messages: [{ role: "user", content: normal }] }, gateway, userId),
      runResponseSchemaLoop(
        { messages: [{ role: "user", content: normal }] },
        gateway,
        userId,
      ),
      runToolContractLoop(
        { messages: [{ role: "user", content: normal }] },
        gateway,
        userId,
      ),
      runSubagentDefinitionLoop(
        { messages: [{ role: "user", content: normal }] },
        gateway,
        userId,
      ),
    ];

    for (const stream of streams) await eventNames(stream);

    expect(seen.map((input) => input.tools.map((tool) => tool.name))).toEqual([
      ["write_skill", "edit_skill"],
      ["write_response_schema", "edit_response_schema"],
      ["write_tool_contract", "edit_tool_contract"],
      ["write_subagent_definition", "edit_subagent_definition"],
    ]);
  });

  it("does not withhold tools for a casual marker mention or malformed envelope", () => {
    expect(isConceptContextMessage("What does [BEGIN AGENTBRANCH CONCEPT CONTEXT v1] mean?")).toBe(
      false,
    );
    expect(
      isConceptContextMessage(
        "[BEGIN AGENTBRANCH CONCEPT CONTEXT v1]\nnot the formatter preamble\n{}\n[END AGENTBRANCH CONCEPT CONTEXT v1]",
      ),
    ).toBe(false);
    expect(isConceptContextMessage(message)).toBe(true);
  });
});
