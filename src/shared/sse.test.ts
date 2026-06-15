import { describe, expect, it } from "vitest";
import { encodeSse, parseSseFrame, readSseEvents } from "./sse";

describe("SSE helpers", () => {
  it("parses a complete frame", () => {
    expect(parseSseFrame('event: ready\ndata: {"ok":true}')).toEqual({
      event: "ready",
      data: { ok: true },
    });
  });

  it("reads events split across stream chunks", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const payload =
          encodeSse({ event: "first", data: { value: 1 } }) +
          encodeSse({ event: "second", data: { value: 2 } });
        controller.enqueue(encoder.encode(payload.slice(0, 18)));
        controller.enqueue(encoder.encode(payload.slice(18)));
        controller.close();
      },
    });

    const events = [];
    for await (const event of readSseEvents(stream)) {
      events.push(event);
    }

    expect(events).toEqual([
      { event: "first", data: { value: 1 } },
      { event: "second", data: { value: 2 } },
    ]);
  });
});
