import { z } from "zod";
import {
  makeSkill,
  type Skill,
  type SkillRepository,
  type SkillSource,
} from "@/modules/skill";
import type { AuthIdentity } from "@/modules/auth";
import {
  err,
  ok,
  LIMIT_MESSAGES,
  SKILL_BODY_MAX,
  SKILL_DESCRIPTION_MAX,
  SKILL_NAME_MAX,
  SkillBranchId,
  SkillId,
  type DomainError,
  type Result,
  type SkillVersionId,
  type UserId,
} from "@/shared";

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

/**
 * Resolve the version an evaluation record should pin to (ARCHITECTURE §6, §9.3).
 * When the request names a draft, we pin to that draft's head; otherwise to the
 * skill's main version. Either way we only pin when the evaluated source matches
 * the stored head — an unsaved in-flight edit records with a null pin, exactly as
 * the linear path already did. This is what makes evaluation *attach to the
 * branch version*, so Insights reflect the draft rather than the blessed version.
 */
export async function resolvePinnedVersionId(
  skills: SkillRepository,
  request: ParsedSkillRequest,
  userId: UserId,
): Promise<Result<SkillVersionId | null, DomainError>> {
  const id = request.skillId ?? request.currentSkillId;
  if (!id) return ok(null);
  const skillId = SkillId(id);

  if (request.branchId) {
    const versions = await skills.listBranchVersions(skillId, userId, SkillBranchId(request.branchId));
    if (!versions.ok) return err(versions.error);
    const head = versions.value[0]; // newest revision first
    if (head && sameSkillSource(head.source, request.source)) return ok(head.id);
    return ok(null);
  }

  const persisted = await skills.findById(skillId, userId);
  if (!persisted.ok) return err(persisted.error);
  if (!persisted.value) return ok(null);
  if (!persisted.value.latestVersionId || !sameSkillSource(persisted.value.source, request.source)) {
    return ok(null);
  }
  return ok(persisted.value.latestVersionId);
}

export function sameSkillSource(a: SkillSource, b: SkillSource): boolean {
  return (
    a.frontmatter.name === b.frontmatter.name &&
    a.frontmatter.description === b.frontmatter.description &&
    JSON.stringify(a.frontmatter.extra) === JSON.stringify(b.frontmatter.extra) &&
    a.body === b.body
  );
}

export function validationMessage(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Invalid request body.";
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
            : error.tag === "invalid_operation"
              ? 409
              : 500;

  return Response.json({ error: error.message, code: error.tag }, { status });
}
