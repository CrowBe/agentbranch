import { z } from "zod";
import { makeSkill, type Skill, type SkillSource } from "@/modules/skill";
import type { AuthIdentity } from "@/modules/auth";
import {
  LIMIT_MESSAGES,
  SKILL_BODY_MAX,
  SKILL_DESCRIPTION_MAX,
  SKILL_NAME_MAX,
  SkillId,
} from "@/shared";

export { domainErrorResponse } from "@/server/http";

const frontmatterSchema = z.object({
  name: z.string().min(1).max(SKILL_NAME_MAX, LIMIT_MESSAGES.skillName),
  description: z.string().min(1).max(SKILL_DESCRIPTION_MAX, LIMIT_MESSAGES.skillDescription),
  extra: z.record(z.string(), z.unknown()).default({}),
});

export const skillSourceSchema = z.object({
  frontmatter: frontmatterSchema,
  body: z.string().max(SKILL_BODY_MAX, LIMIT_MESSAGES.skillBody),
});

const skillRequestSchema = z.object({
  skill: skillSourceSchema.optional(),
  current: skillSourceSchema.optional(),
  skillId: z.string().optional(),
  currentSkillId: z.string().optional(),
  /** The draft being iterated on, if any. Absent means the main version
   * (ARCHITECTURE §9.3): evaluation records pin to the draft head instead. */
  branchId: z.string().optional(),
});

export type SkillRequest = z.infer<typeof skillRequestSchema>;
export type ParsedSkillRequest = SkillRequest & { readonly source: SkillSource };

export function parseSkillRequest(body: unknown):
  | { readonly ok: true; readonly value: ParsedSkillRequest }
  | { readonly ok: false; readonly error: string } {
  const parsed = skillRequestSchema.safeParse(body);
  if (!parsed.success) return { ok: false, error: validationMessage(parsed.error) };

  const source = parsed.data.skill ?? parsed.data.current;
  if (!source) return { ok: false, error: "Send a skill before running this action." };
  return { ok: true, value: { ...parsed.data, source } };
}

export function skillFromRequest(request: ParsedSkillRequest, identity: AuthIdentity): Skill {
  const now = new Date();
  return makeSkill({
    id: SkillId(request.skillId ?? request.currentSkillId ?? "current"),
    userId: identity.userId,
    source: request.source,
    createdAt: now,
    updatedAt: now,
  });
}

export function validationMessage(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Invalid request body.";
}
