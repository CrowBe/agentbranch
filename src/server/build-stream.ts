import { encodeSse, type UserId } from "@/shared";
import {
  applySkillEdit,
  checkSkillCreateCap,
  type SkillRepository,
} from "@/modules/skill";
import { createLintReportForSource } from "@/modules/lint";
import {
  formatLintFeedback,
  runBuildLoop,
  type BuildLoopInput,
  type BuildLoopEvent,
} from "@/modules/build-loop";
import type { ModelGateway } from "@/modules/model-gateway";
import type { Tier } from "@/modules/usage";

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
  tierFor: (userId: UserId) => Promise<Tier> = async () => "free",
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let latestSource = input.current;
      let draftSkillId = input.currentSkillId;
      let checkpointingDisabled = false;
      try {
        for await (const event of runBuildLoop(input, gateway, userId)) {
          if (event.event === "skill") {
            latestSource = event.data.source;
            controller.enqueue(encoder.encode(encodeSse(event)));
            await checkpointDraft(event.data.source);
            const feedback = formatLintFeedback(createLintReportForSource(event.data.source));
            if (feedback) {
              controller.enqueue(
                encoder.encode(
                  encodeSse({
                    event: "lint-feedback",
                    data: { feedback },
                  } satisfies BuildLoopEvent),
                ),
              );
            }
            continue;
          }

          if (event.event === "skill-edit") {
            if (!latestSource) {
              controller.enqueue(
                encoder.encode(
                  encodeSse({ event: "error", data: { message: "No draft exists to edit yet." } }),
                ),
              );
              continue;
            }

            const edited = applySkillEdit(latestSource, event.data.oldStr, event.data.newStr);
            if (!edited.ok) {
              controller.enqueue(
                encoder.encode(
                  encodeSse({ event: "error", data: { message: edited.error.message } }),
                ),
              );
              continue;
            }

            latestSource = edited.value;
            controller.enqueue(encoder.encode(encodeSse(event)));
            await checkpointDraft(latestSource);
            continue;
          }

          if (event.event === "done" && latestSource) {
            if (draftSkillId) {
              const existing = await skills.findById(draftSkillId, userId);
              if (!existing.ok) {
                controller.enqueue(
                  encoder.encode(
                    encodeSse({ event: "error", data: { message: existing.error.message } }),
                  ),
                );
                continue;
              }
              if (!existing.value) {
                controller.enqueue(
                  encoder.encode(
                    encodeSse({ event: "error", data: { message: "Skill not found." } }),
                  ),
                );
                continue;
              }
            }

            if (!draftSkillId) {
              const tier = await tierFor(userId);
              const skillCap = await checkSkillCreateCap({ skills, userId, tier });
              if (!skillCap.ok) {
                controller.enqueue(
                  encoder.encode(
                    encodeSse({ event: "error", data: { message: skillCap.error.message } }),
                  ),
                );
                continue;
              }
            }

            const persisted = draftSkillId
              ? await skills.save({ id: draftSkillId, userId, source: latestSource })
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

      async function checkpointDraft(source: typeof latestSource): Promise<void> {
        if (!source || checkpointingDisabled) return;

        if (!draftSkillId && !input.currentSkillId) {
          const tier = await tierFor(userId);
          const skillCap = await checkSkillCreateCap({ skills, userId, tier });
          if (!skillCap.ok) {
            checkpointingDisabled = true;
            controller.enqueue(
              encoder.encode(encodeSse({ event: "error", data: { message: skillCap.error.message } })),
            );
            return;
          }
        }

        const checkpoint = await skills.checkpoint({ id: draftSkillId, userId, source });
        if (!checkpoint.ok) {
          checkpointingDisabled = true;
          const message = input.currentSkillId ? "Skill not found." : checkpoint.error.message;
          controller.enqueue(
            encoder.encode(encodeSse({ event: "error", data: { message } })),
          );
          return;
        }

        if (!draftSkillId) {
          draftSkillId = checkpoint.value.id;
          controller.enqueue(
            encoder.encode(
              encodeSse({
                event: "skill-checkpoint",
                data: { skillId: checkpoint.value.id },
              } satisfies BuildLoopEvent),
            ),
          );
        }
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
