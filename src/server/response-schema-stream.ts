import { encodeSse, type UserId } from "@/shared";
import {
  applyResponseSchemaEdit,
  createResponseSchemaLintReport,
} from "@/modules/response-schema";
import {
  formatResponseSchemaLintFeedback,
  runResponseSchemaLoop,
  type ResponseSchemaLoopEvent,
  type ResponseSchemaLoopInput,
} from "@/modules/build-loop";
import type { ModelGateway } from "@/modules/model-gateway";

/**
 * Bridge the response-schema authoring loop to an SSE Response — the
 * build-stream pattern for the first equipment primitive (issue #151). Leaner
 * than the skill driver on purpose: an authored schema is not persisted here.
 * Equipment is session-kept by the client workspace (ARCHITECTURE §9.2), which
 * quality-checks and stores the finished document exactly as it does a pasted
 * one. The primitive's pure lint closes the loop: after each write the report
 * is formatted as eval feedback and streamed alongside the draft.
 */
export function responseSchemaLoopResponse(
  input: ResponseSchemaLoopInput,
  gateway: ModelGateway,
  userId: UserId,
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: ResponseSchemaLoopEvent) =>
        controller.enqueue(encoder.encode(encodeSse(event)));
      let latestSource = input.current;

      try {
        for await (const event of runResponseSchemaLoop(input, gateway, userId)) {
          if (event.event === "response-schema") {
            latestSource = event.data.source;
            send(event);
            const feedback = formatResponseSchemaLintFeedback(
              createResponseSchemaLintReport(event.data.source),
            );
            if (feedback) send({ event: "lint-feedback", data: { feedback } });
            continue;
          }

          if (event.event === "response-schema-edit") {
            if (!latestSource) {
              send({ event: "error", data: { message: "No draft exists to edit yet." } });
              continue;
            }
            const edited = applyResponseSchemaEdit(
              latestSource,
              event.data.oldStr,
              event.data.newStr,
            );
            if (!edited.ok) {
              send({ event: "error", data: { message: edited.error.message } });
              continue;
            }
            latestSource = edited.value;
            send(event);
            continue;
          }

          send(event);
        }
      } catch (cause) {
        send({ event: "error", data: { message: String(cause) } });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
