import { encodeSse, type UserId } from "@/shared";
import { applyToolContractEdit, createToolContractLintReport } from "@/modules/tool-contract";
import {
  formatToolContractLintFeedback,
  runToolContractLoop,
  type ToolContractLoopEvent,
  type ToolContractLoopInput,
} from "@/modules/build-loop";
import type { ModelGateway } from "@/modules/model-gateway";

/**
 * Bridge the tool-contract authoring loop to an SSE Response. The finished
 * contract is not persisted here; the workspace keeps equipment for the
 * session, just like pasted contracts. Pure lint closes the loop after each
 * successful write.
 */
export function toolContractLoopResponse(
  input: ToolContractLoopInput,
  gateway: ModelGateway,
  userId: UserId,
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: ToolContractLoopEvent) =>
        controller.enqueue(encoder.encode(encodeSse(event)));
      let latestSource = input.current;

      try {
        for await (const event of runToolContractLoop(input, gateway, userId)) {
          if (event.event === "tool-contract") {
            latestSource = event.data.source;
            send(event);
            const feedback = formatToolContractLintFeedback(
              createToolContractLintReport(event.data.source),
            );
            if (feedback) send({ event: "lint-feedback", data: { feedback } });
            continue;
          }

          if (event.event === "tool-contract-edit") {
            if (!latestSource) {
              send({ event: "error", data: { message: "No draft exists to edit yet." } });
              continue;
            }
            const edited = applyToolContractEdit(
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
