import {
  domainError,
  isErr,
  LIMIT_MESSAGES,
  SKILL_COUNT_MAX,
  type DomainError,
  type Result,
  type UserId,
} from "@/shared";
import type { SkillRepository } from "./skill.repository";

export async function checkSkillCreateCap(input: {
  readonly skills: SkillRepository;
  readonly userId: UserId;
}): Promise<Result<void, DomainError>> {
  const existing = await input.skills.listByUser(input.userId);
  if (isErr(existing)) return existing;

  if (existing.value.length >= SKILL_COUNT_MAX) {
    return {
      ok: false,
      error: domainError("cap_reached", LIMIT_MESSAGES.skillCount),
    };
  }

  return { ok: true, value: undefined };
}
