import { z } from "zod";
import { makeSkill, type Skill, type SkillSource } from "@/modules/skill";
import type { AuthIdentity } from "@/modules/auth";
import { SkillId, type DomainError } from "@/shared";

const frontmatterSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  extra: z.record(z.string(), z.unknown()).default({}),
});

const skillSourceSchema = z.object({
  frontmatter: frontmatterSchema,
  body: z.string(),
});

const skillRequestSchema = z.object({
  skill: skillSourceSchema.optional(),
  current: skillSourceSchema.optional(),
  skillId: z.string().optional(),
  currentSkillId: z.string().optional(),
});

export type SkillRequest = z.infer<typeof skillRequestSchema>;

export function parseSkillRequest(body: unknown):
  | { readonly ok: true; readonly value: SkillRequest & { readonly source: SkillSource } }
  | { readonly ok: false } {
  const parsed = skillRequestSchema.safeParse(body);
  if (!parsed.success) return { ok: false };

  const source = parsed.data.skill ?? parsed.data.current;
  if (!source) return { ok: false };
  return { ok: true, value: { ...parsed.data, source } };
}

export function skillFromRequest(request: SkillRequest & { readonly source: SkillSource }, identity: AuthIdentity): Skill {
  const now = new Date();
  return makeSkill({
    id: SkillId(request.skillId ?? request.currentSkillId ?? "current"),
    userId: identity.userId,
    source: request.source,
    createdAt: now,
    updatedAt: now,
  });
}

export function domainErrorResponse(error: DomainError): Response {
  const status =
    error.tag === "cap_reached"
      ? 429
      : error.tag === "model_unavailable" || error.tag === "not_configured"
        ? 503
        : error.tag === "not_found"
          ? 404
          : error.tag === "auth_failed"
            ? 401
            : 500;

  return Response.json({ error: error.message, code: error.tag }, { status });
}
