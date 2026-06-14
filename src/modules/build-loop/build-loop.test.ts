import { describe, it, expect } from "vitest";
import { runBuildLoop } from "./build-loop";
import type { BuildLoopEvent } from "./build-loop.types";
import type {
  ModelGateway,
  AgentStreamPart,
  StreamAgentInput,
} from "@/modules/model-gateway";
import { ok, err, domainError, UserId, type Result, type DomainError } from "@/shared";

const userId = UserId("u1");

async function collect(gen: AsyncGenerator<BuildLoopEvent>): Promise<BuildLoopEvent[]> {
  const out: BuildLoopEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

/**
 * A gateway whose `streamAgent` either fails to open (DomainError) or yields a
 * fixed list of parts. The other primitives are unused by the build loop.
 */
function fakeGateway(
  outcome: AgentStreamPart[] | DomainError,
  onInput?: (input: StreamAgentInput) => void,
): ModelGateway {
  return {
    hasModel: true,
    classify: async () => err(domainError("model_unavailable", "n/a")),
    runAgent: async () => err(domainError("model_unavailable", "n/a")),
    generate: async () => err(domainError("model_unavailable", "n/a")),
    async streamAgent(
      input: StreamAgentInput,
    ): Promise<Result<AsyncGenerator<AgentStreamPart>, DomainError>> {
      onInput?.(input);
      if (!Array.isArray(outcome)) return err(outcome);
      const list = outcome;
      async function* parts(): AsyncGenerator<AgentStreamPart> {
        for (const p of list) yield p;
      }
      return ok(parts());
    },
  };
}

describe("build loop", () => {
  it("yields a single error event when the gateway can't open a stream", async () => {
    const gateway = fakeGateway(domainError("model_unavailable", "No model is configured."));
    const events = await collect(
      runBuildLoop({ messages: [{ role: "user", content: "Make a skill" }] }, gateway, userId),
    );
    expect(events).toHaveLength(1);
    expect(events[0]!.event).toBe("error");
    expect(events[0]!.data).toHaveProperty("message", "No model is configured.");
  });

  it("maps gateway stream parts to build events (text, skill write, done)", async () => {
    const skillMd = `---\nname: greeter\ndescription: Greets people warmly\n---\nSay hello.`;
    const gateway = fakeGateway([
      { kind: "text", delta: "Drafting..." },
      { kind: "tool-call", tool: "write_skill" },
      { kind: "tool-result", tool: "write_skill", output: { ok: true, content: skillMd } },
      { kind: "finish", finishReason: "stop" },
    ]);

    const events = await collect(
      runBuildLoop({ messages: [{ role: "user", content: "Make a greeter" }] }, gateway, userId),
    );

    expect(events.map((e) => e.event)).toEqual(["text", "tool", "tool", "skill", "done"]);
    const skill = events.find((e) => e.event === "skill");
    expect(skill?.data).toHaveProperty("source");
  });

  it("opens the authoring stream with a cacheable frozen system prompt", async () => {
    let input: StreamAgentInput | undefined;
    const gateway = fakeGateway([{ kind: "finish", finishReason: "stop" }], (seen) => {
      input = seen;
    });

    await collect(
      runBuildLoop({ messages: [{ role: "user", content: "Make a greeter" }] }, gateway, userId),
    );

    expect(input?.system).toMatchObject({
      cacheControl: { type: "ephemeral" },
    });
    expect(typeof input?.system === "object" ? input.system.content.length : 0).toBeGreaterThan(
      12_000,
    );
  });

  it("marks the latest message as cacheable for multi-turn reuse", async () => {
    let input: StreamAgentInput | undefined;
    const gateway = fakeGateway([{ kind: "finish", finishReason: "stop" }], (seen) => {
      input = seen;
    });

    await collect(
      runBuildLoop(
        {
          messages: [
            { role: "user", content: "Make a greeter" },
            { role: "assistant", content: "Drafted" },
            { role: "user", content: "Make it concise" },
          ],
        },
        gateway,
        userId,
      ),
    );

    expect(input?.messages).toEqual([
      { role: "user", content: "Make a greeter" },
      { role: "assistant", content: "Drafted" },
      {
        role: "user",
        content: "Make it concise",
        cacheControl: { type: "ephemeral" },
      },
    ]);
  });
});
