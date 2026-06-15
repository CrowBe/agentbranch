/**
 * SSE envelope shared by the build loop (server) and the preview (client).
 * The transport is Server-Sent Events; this is the typed contract for what
 * flows over it. Kept here in the kernel so both sides import one source.
 */
export type SseEvent<TName extends string, TData> = {
  readonly event: TName;
  readonly data: TData;
};

export type EvaluationEvent =
  | SseEvent<"eval-progress", { readonly message: string }>
  | SseEvent<
      "eval-case",
      {
        readonly index: number;
        readonly total: number;
        readonly prompt: string;
        readonly expected: "fire" | "silent";
        readonly actual: "fire" | "silent";
        readonly pass: boolean;
        readonly rationale: string;
      }
    >
  | SseEvent<"artifact", { readonly surface: "insights" | "breakdown"; readonly body: unknown }>
  | SseEvent<"error", { readonly message: string; readonly code?: string }>;

/** Encode a typed event into the SSE wire format. Accepts any event shape so a
 * discriminated-union of events (e.g. BuildLoopEvent) can be streamed as-is. */
export function encodeSse(event: { event: string; data: unknown }): string {
  return `event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`;
}

export async function* readSseEvents<TEvent extends { event: string; data: unknown }>(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<TEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const event = parseSseFrame<TEvent>(frame);
      if (event) yield event;
    }
  }

  buffer += decoder.decode();
  const event = parseSseFrame<TEvent>(buffer);
  if (event) yield event;
}

export function parseSseFrame<TEvent extends { event: string; data: unknown }>(
  frame: string,
): TEvent | null {
  const lines = frame.split("\n");
  const event = lines.find((line) => line.startsWith("event: "))?.slice("event: ".length);
  const data = lines
    .filter((line) => line.startsWith("data: "))
    .map((line) => line.slice("data: ".length))
    .join("\n");

  if (!event || !data) return null;
  return { event, data: JSON.parse(data) } as TEvent;
}
