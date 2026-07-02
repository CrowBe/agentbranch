import { z } from "zod";
import { LIMIT_MESSAGES, MESSAGES_MAX, MESSAGE_CONTENT_MAX } from "@/shared";
import { skillSourceSchema, validationMessage } from "./skill-request";

export const buildRequestSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(MESSAGE_CONTENT_MAX, LIMIT_MESSAGES.messageContent),
      }),
    )
    .min(1)
    .max(MESSAGES_MAX, LIMIT_MESSAGES.messages),
  current: skillSourceSchema.optional(),
  currentSkillId: z.string().optional(),
  branchId: z.string().optional(),
});

export type BuildRequest = z.infer<typeof buildRequestSchema>;

export function parseBuildRequest(body: unknown):
  | { readonly ok: true; readonly value: BuildRequest }
  | { readonly ok: false; readonly error: string } {
  const parsed = buildRequestSchema.safeParse(body);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, error: validationMessage(parsed.error) };
}
