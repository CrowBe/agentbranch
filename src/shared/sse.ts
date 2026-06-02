/**
 * SSE envelope shared by the build loop (server) and the preview (client).
 * The transport is Server-Sent Events; this is the typed contract for what
 * flows over it. Kept here in the kernel so both sides import one source.
 */
export type SseEvent<TName extends string, TData> = {
  readonly event: TName;
  readonly data: TData;
};

/** Encode a typed event into the SSE wire format. Accepts any event shape so a
 * discriminated-union of events (e.g. BuildLoopEvent) can be streamed as-is. */
export function encodeSse(event: { event: string; data: unknown }): string {
  return `event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`;
}
