import { encodeSse, type UserId } from "@/shared";
import { createSubagentDefinitionLintReport, parseSubagentDefinition, serializeSubagentDefinition } from "@/modules/subagent-definition";
import { formatSubagentDefinitionLintFeedback, runSubagentDefinitionLoop, type SubagentDefinitionLoopEvent, type SubagentDefinitionLoopInput } from "@/modules/build-loop";
import type { ModelGateway } from "@/modules/model-gateway";

export function subagentDefinitionLoopResponse(input: SubagentDefinitionLoopInput, gateway: ModelGateway, userId: UserId): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({ async start(controller) {
    const send = (event: SubagentDefinitionLoopEvent) => controller.enqueue(encoder.encode(encodeSse(event)));
    let latest = input.current;
    try {
      for await (const event of runSubagentDefinitionLoop(input, gateway, userId)) {
        if (event.event === "subagent-definition") { latest = event.data.source; send(event); const feedback = formatSubagentDefinitionLintFeedback(createSubagentDefinitionLintReport(latest)); if (feedback) send({ event: "lint-feedback", data: { feedback } }); continue; }
        if (event.event === "subagent-definition-edit") { if (!latest) { send({ event: "error", data: { message: "No draft exists to edit yet." } }); continue; } const raw = serializeSubagentDefinition(latest); if (!raw.includes(event.data.oldStr)) { send({ event: "error", data: { message: "The exact text to replace was not found." } }); continue; } const parsed = parseSubagentDefinition(raw.replace(event.data.oldStr, event.data.newStr)); if (!parsed.ok) { send({ event: "error", data: { message: parsed.error.message } }); continue; } latest = parsed.value; send(event); continue; }
        send(event);
      }
    } catch (cause) { send({ event: "error", data: { message: String(cause) } }); } finally { controller.close(); }
  }});
  return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" } });
}
