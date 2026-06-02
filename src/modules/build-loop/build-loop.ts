import { streamText, type ModelMessage } from "ai";
import { parseSkillMd } from "@/modules/skill";
import { buildTools } from "./tools";
import type { ModelProvider } from "./model-provider";
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
 * harness (Vercel AI SDK + Claude) with a tool registry. The mapping from the
 * SDK's stream parts to our `BuildLoopEvent`s is a deliberately loose adapter
 * boundary — it absorbs SDK-version field churn so the rest of the app sees a
 * stable, typed event contract. Wired for real; degrades to one error event
 * when no model key is configured.
 */
export async function* runBuildLoop(
  input: BuildLoopInput,
  provider: ModelProvider,
): AsyncGenerator<BuildLoopEvent> {
  if (!provider.model) {
    yield {
      event: "error",
      data: { message: "Model provider not configured — add ANTHROPIC_API_KEY." },
    };
    return;
  }

  const messages: ModelMessage[] = input.messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  const result = streamText({
    model: provider.model,
    system: SYSTEM_PROMPT,
    messages,
    tools: buildTools,
  });

  for await (const rawPart of result.fullStream) {
    const part = rawPart as { type: string } & Record<string, unknown>;
    switch (part.type) {
      case "text-delta": {
        const delta = readString(part, "text") ?? readString(part, "textDelta");
        if (delta) yield { event: "text", data: { delta } };
        break;
      }
      case "tool-call":
        yield { event: "tool", data: { name: readString(part, "toolName") ?? "", phase: "call" } };
        break;
      case "tool-result": {
        const name = readString(part, "toolName") ?? "";
        yield { event: "tool", data: { name, phase: "result" } };
        yield* mapToolResult(name, part.output ?? part.result);
        break;
      }
      case "finish":
        yield { event: "done", data: { finishReason: readString(part, "finishReason") ?? "stop" } };
        break;
      case "error":
        yield { event: "error", data: { message: String(part.error ?? "Unknown error") } };
        break;
      default:
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

function readString(obj: Record<string, unknown>, key: string): string | undefined {
  const value = obj[key];
  return typeof value === "string" ? value : undefined;
}
