import { describe, it, expect } from "vitest";
import { runBuildLoop } from "./build-loop";
import type { ModelProvider } from "./model-provider";
import type { BuildLoopEvent } from "./build-loop.types";

async function collect(gen: AsyncGenerator<BuildLoopEvent>): Promise<BuildLoopEvent[]> {
  const out: BuildLoopEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

describe("build loop", () => {
  it("degrades to a single error event when no model is configured", async () => {
    const provider: ModelProvider = { model: null };
    const events = await collect(
      runBuildLoop({ messages: [{ role: "user", content: "Make a skill" }] }, provider),
    );
    expect(events).toHaveLength(1);
    expect(events[0]!.event).toBe("error");
    expect(events[0]!.data).toHaveProperty("message");
  });
});
