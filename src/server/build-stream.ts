import { encodeSse, type UserId } from "@/shared";
import {
  parseSkillMd,
  serializeSkillMd,
  type SkillRepository,
  type SkillSource,
} from "@/modules/skill";
import { runBuildLoop, type BuildLoopInput, type BuildLoopEvent } from "@/modules/build-loop";
import type { ModelGateway } from "@/modules/model-gateway";

/**
 * Bridge the build loop's typed event generator to an SSE Response. This is the
 * route handler's whole job: run the loop through the model gateway (which owns
 * the key + accounting) and stream events to the browser preview (ARCHITECTURE §3).
 */
export function buildLoopResponse(
  input: BuildLoopInput,
  gateway: ModelGateway,
  skills: SkillRepository,
  userId: UserId,
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let latestSource = input.current;
      try {
        for await (const event of runBuildLoop(input, gateway, userId)) {
          if (event.event === "skill") {
            latestSource = event.data.source;
            controller.enqueue(encoder.encode(encodeSse(event)));
            continue;
          }

          if (event.event === "skill-edit") {
            latestSource = applySkillEdit(latestSource, event.data.oldStr, event.data.newStr);
            controller.enqueue(encoder.encode(encodeSse(event)));
            continue;
          }

          if (event.event === "done" && latestSource) {
            if (input.currentSkillId) {
              const existing = await skills.findById(input.currentSkillId);
              if (!existing.ok) {
                controller.enqueue(
                  encoder.encode(
                    encodeSse({ event: "error", data: { message: existing.error.message } }),
                  ),
                );
                continue;
              }
              if (!existing.value || existing.value.userId !== userId) {
                controller.enqueue(
                  encoder.encode(
                    encodeSse({ event: "error", data: { message: "Skill not found." } }),
                  ),
                );
                continue;
              }
            }

            const persisted = input.currentSkillId
              ? await skills.save({ id: input.currentSkillId, source: latestSource })
              : await skills.create({ userId, source: latestSource });
            if (!persisted.ok) {
              controller.enqueue(
                encoder.encode(
                  encodeSse({ event: "error", data: { message: persisted.error.message } }),
                ),
              );
              continue;
            }
            controller.enqueue(
              encoder.encode(
                encodeSse({
                  event: "done",
                  data: {
                    ...event.data,
                    skillId: persisted.value.id,
                    revision: persisted.value.latestRevision,
                  },
                } satisfies BuildLoopEvent),
              ),
            );
            continue;
          }

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

function applySkillEdit(
  current: SkillSource | undefined,
  oldStr: string,
  newStr: string,
): SkillSource | undefined {
  if (!current) return current;
  const raw = serializeSkillMd(current);
  const nextRaw = raw.replace(oldStr, newStr);
  if (nextRaw === raw) return current;
  const parsed = parseSkillMd(nextRaw);
  return parsed.ok ? parsed.value : current;
}
