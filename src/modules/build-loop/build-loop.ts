import { parseSkillMd } from "@/modules/skill";
import type { ModelGateway } from "@/modules/model-gateway";
import { isErr, type UserId } from "@/shared";
import { buildTools } from "./tools";
import type { BuildLoopInput, BuildLoopEvent } from "./build-loop.types";

const SYSTEM_PROMPT = `You are SkillBuilder's authoring agent. You help a user
craft a single Claude Skill — an instruction-only SKILL.md (YAML frontmatter
with name + description, then a markdown body). On a first draft call
write_skill with the complete document. On revisions call edit_skill with an
exact string replacement. Keep skills focused, with clear triggers and any
constraints stated plainly. Never include runnable code — skills are
instructions only.`;

/**
 * Run the build loop and stream typed events.
 *
 * This is the spine of the product (ARCHITECTURE §3): one server-side agentic
 * harness with a tool registry. The model is reached only through the **model
 * gateway** (`streamAgent`) — the platform's single metered entry — so a build
 * turn is gated against the user's tier and its tokens accounted, exactly like
 * an evaluation. The gateway hands back a stable `AgentStreamPart` stream; this
 * loop maps those parts to `BuildLoopEvent`s, owning only the *domain* meaning
 * (parse the tool's SKILL.md), not the SDK's wire shape. Degrades to one error
 * event when the gateway can't open a stream (no key → `model_unavailable`, or
 * over the build cap → `cap_reached`).
 */
export async function* runBuildLoop(
  input: BuildLoopInput,
  gateway: ModelGateway,
  userId: UserId,
): AsyncGenerator<BuildLoopEvent> {
  const opened = await gateway.streamAgent({
    system: SYSTEM_PROMPT,
    messages: input.messages.map((m) => ({ role: m.role, content: m.content })),
    tools: buildTools,
    // The build loop spends a user's allowance under the `build` capability; the
    // gateway clears it against the tier cap before any part streams.
    tag: { kind: "account", userId, capability: "build" },
  });
  if (isErr(opened)) {
    yield { event: "error", data: { message: opened.error.message } };
    return;
  }

  for await (const part of opened.value) {
    switch (part.kind) {
      case "text":
        if (part.delta) yield { event: "text", data: { delta: part.delta } };
        break;
      case "tool-call":
        yield { event: "tool", data: { name: part.tool, phase: "call" } };
        break;
      case "tool-result":
        yield { event: "tool", data: { name: part.tool, phase: "result" } };
        yield* mapToolResult(part.tool, part.output);
        break;
      case "finish":
        yield { event: "done", data: { finishReason: part.finishReason } };
        break;
      case "error":
        yield { event: "error", data: { message: part.message } };
        break;
    }
  }
}

/** Translate a tool's output into preview events (skill replace / patch). */
function* mapToolResult(name: string, output: unknown): Generator<BuildLoopEvent> {
  if (output === null || typeof output !== "object") return;
  const out = output as Record<string, unknown>;

  if (name === "write_skill" && typeof out.content === "string") {
    const parsed = parseSkillMd(out.content);
    if (parsed.ok) yield { event: "skill", data: { source: parsed.value } };
    return;
  }
  if (name === "edit_skill" && typeof out.oldStr === "string" && typeof out.newStr === "string") {
    yield { event: "skill-edit", data: { oldStr: out.oldStr, newStr: out.newStr } };
  }
}
