import { parseResponseSchema, type ResponseSchemaSource } from "@/modules/response-schema";
import type { ModelGateway } from "@/modules/model-gateway";
import { isErr, type SseEvent, type UserId } from "@/shared";
import { responseSchemaTools } from "./response-schema-tools";
import { RESPONSE_SCHEMA_AUTHORING_PROMPT } from "./response-schema-prompt";
import { withLatestMessageCacheControl } from "./gateway-messages";
import type { BuildMessage } from "./build-loop.types";

export type ResponseSchemaLoopInput = {
  readonly messages: readonly BuildMessage[];
  /** The schema being revised, if any (absent on a first draft). */
  readonly current?: ResponseSchemaSource;
};

/**
 * The typed events the response-schema authoring loop streams over SSE. Same
 * document-model shape as `BuildLoopEvent`: `response-schema` replaces the
 * draft wholesale (write_response_schema), `response-schema-edit` patches it
 * (edit_response_schema). `lint-feedback` is emitted by the server driver
 * after a write — the primitive's pure lint closing the loop, exactly as
 * skill lint does for the skill loop.
 */
export type ResponseSchemaLoopEvent =
  | SseEvent<"text", { readonly delta: string }>
  | SseEvent<"response-schema", { readonly source: ResponseSchemaSource }>
  | SseEvent<"response-schema-edit", { readonly oldStr: string; readonly newStr: string }>
  | SseEvent<"lint-feedback", { readonly feedback: string }>
  | SseEvent<"tool", { readonly name: string; readonly phase: "call" | "result" }>
  | SseEvent<"done", { readonly finishReason: string }>
  | SseEvent<"error", { readonly message: string }>;

/**
 * Run the response-schema authoring loop and stream typed events — the build
 * loop's shape (ARCHITECTURE §4) applied to the first equipment primitive
 * (issue #151). The model is reached only through the **model gateway**
 * (`streamAgent`) with the frozen cacheable authoring prompt; the turn spends
 * the user's allowance under the same `build` capability as a skill turn,
 * because tier policy caps authoring turns, not which primitive they author.
 */
export async function* runResponseSchemaLoop(
  input: ResponseSchemaLoopInput,
  gateway: ModelGateway,
  userId: UserId,
): AsyncGenerator<ResponseSchemaLoopEvent> {
  const opened = await gateway.streamAgent({
    system: RESPONSE_SCHEMA_AUTHORING_PROMPT,
    messages: withLatestMessageCacheControl(input.messages),
    tools: responseSchemaTools,
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

/** Translate a tool's output into draft events (schema replace / patch). */
function* mapToolResult(name: string, output: unknown): Generator<ResponseSchemaLoopEvent> {
  if (output === null || typeof output !== "object") return;
  const out = output as Record<string, unknown>;

  if (name === "write_response_schema" && typeof out.content === "string") {
    const parsed = parseResponseSchema(out.content);
    if (parsed.ok) yield { event: "response-schema", data: { source: parsed.value } };
    return;
  }
  if (
    name === "edit_response_schema" &&
    typeof out.oldStr === "string" &&
    typeof out.newStr === "string"
  ) {
    yield { event: "response-schema-edit", data: { oldStr: out.oldStr, newStr: out.newStr } };
  }
}
