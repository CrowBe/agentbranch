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
            // Draft build (ARCHITECTURE §9.3): append the completed turn to the
            // draft's head. The blessed main pointer never moves — only promote
            // changes it — so the version the user trusts is untouched here.
            if (input.branchId && input.currentSkillId) {
              const saved = await skills.saveToBranch({
                id: input.currentSkillId,
                userId,
                branchId: input.branchId,
                source: latestSource,
              });
              if (!saved.ok) {
                controller.enqueue(
                  encoder.encode(
                    encodeSse({ event: "error", data: { message: saved.error.message } }),
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
                      skillId: input.currentSkillId,
                      revision: saved.value.revision,
                    },
                  } satisfies BuildLoopEvent),
                ),
              );
              continue;
            }

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
              const skillCap = await checkSkillCreateCap({ skills, userId });
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
        // A draft build persists only on `done` (via saveToBranch). Interim
        // checkpoints write the skill aggregate's working source, which belongs
        // to the main lineage — skipping them keeps the blessed version legibly
        // unchanged mid-draft (ARCHITECTURE §9.3).
        if (input.branchId) return;

        if (!draftSkillId && !input.currentSkillId) {
          const skillCap = await checkSkillCreateCap({ skills, userId });
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
