import { parseToolContract, type ToolContractSource } from "@/modules/tool-contract";
import type { ModelGateway } from "@/modules/model-gateway";
import { isErr, type SseEvent, type UserId } from "@/shared";
import { withLatestMessageCacheControl } from "./gateway-messages";
import { TOOL_CONTRACT_AUTHORING_PROMPT } from "./tool-contract-prompt";
import { toolContractTools } from "./tool-contract-tools";
import type { BuildMessage } from "./build-loop.types";

export type ToolContractLoopInput = {
  readonly messages: readonly BuildMessage[];
  /** The contract being revised, if any (absent on a first draft). */
  readonly current?: ToolContractSource;
};

/**
 * The typed events the tool-contract authoring loop streams over SSE. Same
 * equipment document-model shape as the response-schema loop: a whole-contract
 * write, targeted edits, and lint feedback emitted by the server driver after
 * a successful write.
 */
export type ToolContractLoopEvent =
  | SseEvent<"text", { readonly delta: string }>
  | SseEvent<"tool-contract", { readonly source: ToolContractSource }>
  | SseEvent<"tool-contract-edit", { readonly oldStr: string; readonly newStr: string }>
  | SseEvent<"lint-feedback", { readonly feedback: string }>
  | SseEvent<"tool", { readonly name: string; readonly phase: "call" | "result" }>
  | SseEvent<"done", { readonly finishReason: string }>
  | SseEvent<"error", { readonly message: string }>;

/**
 * Run the tool-contract authoring loop and stream typed events. The model is
 * reached only through the model gateway with the frozen cacheable authoring
 * prompt, and spends under the `build` capability like other authoring turns.
 */
export async function* runToolContractLoop(
  input: ToolContractLoopInput,
  gateway: ModelGateway,
  userId: UserId,
): AsyncGenerator<ToolContractLoopEvent> {
  const opened = await gateway.streamAgent({
    system: TOOL_CONTRACT_AUTHORING_PROMPT,
    messages: withLatestMessageCacheControl(input.messages),
    tools: toolContractTools,
    tag: { kind: "account", userId, capability: "build" },
  });
  if (isErr(opened)) {
    yield { event: "error", data: { message: opened.error.message } };
    return;
  }

  for await (const part of opened.value) {
    switch (part.kind) {
      case "text":
        if (part.delta) yield { event: "text", data: { delta: part.delta } };
        break;
      case "tool-call":
        yield { event: "tool", data: { name: part.tool, phase: "call" } };
        break;
      case "tool-result":
        yield { event: "tool", data: { name: part.tool, phase: "result" } };
        yield* mapToolResult(part.tool, part.output);
        break;
      case "finish":
        yield { event: "done", data: { finishReason: part.finishReason } };
        break;
      case "error":
        yield { event: "error", data: { message: part.message } };
        break;
    }
  }
}

function* mapToolResult(name: string, output: unknown): Generator<ToolContractLoopEvent> {
  if (output === null || typeof output !== "object") return;
  const out = output as Record<string, unknown>;

  if (name === "write_tool_contract" && typeof out.content === "string") {
    const parsed = parseToolContract(out.content);
    if (parsed.ok) yield { event: "tool-contract", data: { source: parsed.value } };
    return;
  }
  if (
    name === "edit_tool_contract" &&
    typeof out.oldStr === "string" &&
    typeof out.newStr === "string"
  ) {
    yield { event: "tool-contract-edit", data: { oldStr: out.oldStr, newStr: out.newStr } };
  }
}
