import { parseSubagentDefinition, type SubagentDefinitionSource } from "@/modules/subagent-definition";
import type { ModelGateway } from "@/modules/model-gateway";
import { isErr, type SseEvent, type UserId } from "@/shared";
import { withLatestMessageCacheControl } from "./gateway-messages";
import type { BuildMessage } from "./build-loop.types";
import { subagentDefinitionTools } from "./subagent-definition-tools";
import { SUBAGENT_DEFINITION_AUTHORING_PROMPT } from "./subagent-definition-prompt";

export type SubagentDefinitionLoopInput = { readonly messages: readonly BuildMessage[]; readonly current?: SubagentDefinitionSource };
export type SubagentDefinitionLoopEvent = SseEvent<"text", { readonly delta: string }> | SseEvent<"subagent-definition", { readonly source: SubagentDefinitionSource }> | SseEvent<"subagent-definition-edit", { readonly oldStr: string; readonly newStr: string }> | SseEvent<"lint-feedback", { readonly feedback: string }> | SseEvent<"tool", { readonly name: string; readonly phase: "call" | "result" }> | SseEvent<"done", { readonly finishReason: string }> | SseEvent<"error", { readonly message: string }>;

export async function* runSubagentDefinitionLoop(input: SubagentDefinitionLoopInput, gateway: ModelGateway, userId: UserId): AsyncGenerator<SubagentDefinitionLoopEvent> {
  const opened = await gateway.streamAgent({ system: SUBAGENT_DEFINITION_AUTHORING_PROMPT, messages: withLatestMessageCacheControl(input.messages), tools: subagentDefinitionTools, tag: { kind: "account", userId, capability: "build" } });
  if (isErr(opened)) { yield { event: "error", data: { message: opened.error.message } }; return; }
  for await (const part of opened.value) {
    if (part.kind === "text" && part.delta) yield { event: "text", data: { delta: part.delta } };
    else if (part.kind === "tool-call") yield { event: "tool", data: { name: part.tool, phase: "call" } };
    else if (part.kind === "tool-result") { yield { event: "tool", data: { name: part.tool, phase: "result" } }; const out = part.output as Record<string, unknown> | null; if (out && part.tool === "write_subagent_definition" && typeof out.content === "string") { const parsed = parseSubagentDefinition(out.content); if (parsed.ok) yield { event: "subagent-definition", data: { source: parsed.value } }; } else if (out && part.tool === "edit_subagent_definition" && typeof out.oldStr === "string" && typeof out.newStr === "string") yield { event: "subagent-definition-edit", data: { oldStr: out.oldStr, newStr: out.newStr } }; }
    else if (part.kind === "finish") yield { event: "done", data: { finishReason: part.finishReason } };
    else if (part.kind === "error") yield { event: "error", data: { message: part.message } };
  }
}
