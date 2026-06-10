import { encodeSse, isErr, type DomainError, type EvaluationEvent, type Result } from "@/shared";

export type EvaluationSurface = "insights" | "breakdown";
export type EvaluationEmit = (event: EvaluationEvent) => void;

export function wantsSse(request: Request): boolean {
  return request.headers.get("accept")?.includes("text/event-stream") ?? false;
}

export function evaluationStreamResponse(
  run: (emit: EvaluationEmit) => Promise<Result<unknown, DomainError>>,
  surface: EvaluationSurface,
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit: EvaluationEmit = (event) => {
        controller.enqueue(encoder.encode(encodeSse(event)));
      };

      try {
        const result = await run(emit);
        if (isErr(result)) {
          emit({ event: "error", data: { message: result.error.message, code: result.error.tag } });
          return;
        }
        emit({ event: "artifact", data: { surface, body: result.value } });
      } catch (cause) {
        emit({ event: "error", data: { message: String(cause) } });
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
