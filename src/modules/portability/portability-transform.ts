import type { Skill } from "@/modules/skill";
import { domainError, type Result, type DomainError } from "@/shared";
import type { PortabilityProvider, TransformedSkill } from "./portability.types";

/**
 * The portability transform — *one engine, two surfaces* (ARCHITECTURE §9):
 * cross-provider validation and cross-primitive export. Designed here, not
 * built: both surfaces are deferred. The signature is the committed contract so
 * the two callers can be written against it now.
 *
 * STUB: returns `not_configured` until the engine is implemented.
 */
export function transformSkill(
  _skill: Skill,
  _provider: PortabilityProvider,
): Result<TransformedSkill, DomainError> {
  return {
    ok: false,
    error: domainError(
      "not_configured",
      "The portability transform is designed but not yet built (ARCHITECTURE §9).",
    ),
  };
}
