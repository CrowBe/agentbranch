import { z } from "zod";
import { getContainer } from "@/server/container";
import { triggeringEvalCapability } from "@/modules/triggering-eval";
import {
  domainError,
  err,
  isErr,
  ok,
  SkillId,
  type DomainError,
  type Result,
  type SkillVersionId,
  type UserId,
} from "@/shared";
import {
  parseSkillRequest,
  skillFromRequest,
  domainErrorResponse,
  sameSkillSource,
  type ParsedSkillRequest,
} from "../_shared/skill-request";
import { invalidRequestResponse, parseJsonRequest } from "../_shared/request-body";

export const runtime = "nodejs";

const surfaceSchema = z.enum(["insights", "breakdown"]).default("insights");

export async function POST(request: Request): Promise<Response> {
  const container = getContainer();
  const identity = await container.auth.currentIdentity();
  if (!identity.ok) return domainErrorResponse(identity.error);
  if (identity.value === null) {
    return Response.json({ error: "Sign in to run triggering eval." }, { status: 401 });
  }

  const body = await parseJsonRequest(request);
  if (!body.ok) return body.response;

  const parsed = parseSkillRequest(body.value);
  const surface = surfaceSchema.safeParse(
    typeof body.value === "object" && body.value !== null && "surface" in body.value
      ? body.value.surface
      : undefined,
  );
  if (!parsed.ok || !surface.success) {
    return invalidRequestResponse(parsed.ok ? "Invalid request body." : parsed.error);
  }

  const skill = skillFromRequest(parsed.value, identity.value);
  if (!container.modelGateway.hasModel) {
    return domainErrorResponse(
      domainError(
        "model_unavailable",
        `"${triggeringEvalCapability.name}" needs a model connection to run. Test runs and triggering evals are unavailable offline.`,
      ),
    );
  }

  const result = await triggeringEvalCapability.evaluator.evaluate(skill, container.modelGateway);
  if (isErr(result)) return domainErrorResponse(result.error);

  const skillVersionId = await resolvedSkillVersionId(parsed.value, identity.value.userId);
  if (isErr(skillVersionId)) return domainErrorResponse(skillVersionId.error);

  const recorded = await container.evalRuns.record({
    userId: skill.userId,
    skillId: skill.id,
    skillVersionId: skillVersionId.value,
    status: result.value.passed ? "passed" : "failed",
    result: result.value,
  });
  if (isErr(recorded)) return domainErrorResponse(recorded.error);

  return Response.json(triggeringEvalCapability.renderers[surface.data].render(result.value));
}

async function resolvedSkillVersionId(
  request: ParsedSkillRequest,
  userId: UserId,
): Promise<Result<SkillVersionId | null, DomainError>> {
  const container = getContainer();
  const id = request.skillId ?? request.currentSkillId;
  if (!id) return ok(null);

  const persisted = await container.skills.findById(SkillId(id));
  if (!persisted.ok) return err(persisted.error);
  if (!persisted.value || persisted.value.userId !== userId) return ok(null);
  if (!persisted.value.latestVersionId || !sameSkillSource(persisted.value.source, request.source)) {
    return ok(null);
  }
  return ok(persisted.value.latestVersionId);
}
