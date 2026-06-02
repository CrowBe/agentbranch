import { encodeSse } from "@/shared";
import { runBuildLoop, type BuildLoopInput, type ModelProvider } from "@/modules/build-loop";

/**
 * Bridge the build loop's typed event generator to an SSE Response. This is the
 * route handler's whole job: own the key (via the provider), run the loop, and
 * stream events to the browser preview (ARCHITECTURE §3).
 */
export function buildLoopResponse(
  input: BuildLoopInput,
  provider: ModelProvider,
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of runBuildLoop(input, provider)) {
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
