import { encodeSse, type UserId } from "@/shared";
import { runBuildLoop, type BuildLoopInput } from "@/modules/build-loop";
import type { ModelGateway } from "@/modules/model-gateway";

/**
 * Bridge the build loop's typed event generator to an SSE Response. This is the
 * route handler's whole job: run the loop through the model gateway (which owns
 * the key + accounting) and stream events to the browser preview (ARCHITECTURE §3).
 */
export function buildLoopResponse(
  input: BuildLoopInput,
  gateway: ModelGateway,
  userId: UserId,
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of runBuildLoop(input, gateway, userId)) {
          controller.enqueue(encoder.encode(encodeSse(event)));
        }
      } catch (cause) {
        controller.enqueue(
          encoder.encode(encodeSse({ event: "error", data: { message: String(cause) } })),
        );
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
