import { z } from "zod";
import { getContainer } from "@/server/container";
import type { AuthIdentity } from "@/modules/auth";
import { testRunCapability } from "@/modules/test-run";
import {
  domainError,
  err,
  isErr,
  ok,
  type DomainError,
  type Result,
} from "@/shared";
import {
  parseSkillRequest,
  skillFromRequest,
  domainErrorResponse,
  resolvePinnedVersionId,
  type ParsedSkillRequest,
} from "../_shared/skill-request";
import { invalidRequestResponse, parseJsonRequest } from "../_shared/request-body";
import {
  evaluationStreamResponse,
  wantsSse,
  type EvaluationEmit,
  type EvaluationResponse,
  type EvaluationSurface,
} from "../_shared/evaluation-stream";

export const runtime = "nodejs";

const surfaceSchema = z.enum(["insights", "breakdown"]).default("insights");

export async function POST(request: Request): Promise<Response> {
  const container = getContainer();
  const identity = await container.auth.currentIdentity();
  if (!identity.ok) return domainErrorResponse(identity.error);
  if (identity.value === null) {
    return Response.json({ error: "Sign in to run a skill test." }, { status: 401 });
  }
  const authIdentity = identity.value;

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

  if (!container.modelGateway.hasModel) {
    return domainErrorResponse(
      domainError(
        "model_unavailable",
        `"${testRunCapability.name}" needs a model connection to run. Test runs and triggering evals are unavailable offline.`,
      ),
    );
  }

  if (wantsSse(request)) {
    return evaluationStreamResponse(
      (emit) => runTestRun(parsed.value, authIdentity, surface.data, emit),
      surface.data,
    );
  }

  const rendered = await runTestRun(parsed.value, authIdentity, surface.data);
  if (isErr(rendered)) return domainErrorResponse(rendered.error);
  return Response.json(rendered.value.body);
}

async function runTestRun(
  request: ParsedSkillRequest,
  identity: AuthIdentity,
  surface: EvaluationSurface,
  emit?: EvaluationEmit,
): Promise<Result<EvaluationResponse, DomainError>> {
  const container = getContainer();
  const skill = skillFromRequest(request, identity);
  emit?.({ event: "eval-progress", data: { message: "Preparing mock world." } });
  const result = await testRunCapability.evaluator.evaluate(skill, container.modelGateway);
  if (isErr(result)) return err(result.error);

  emit?.({ event: "eval-progress", data: { message: "Recording test run." } });
  const skillVersionId = await resolvePinnedVersionId(container.skills, request, identity.userId);
  if (isErr(skillVersionId)) return err(skillVersionId.error);

  const recorded = await container.testRuns.record({
    userId: skill.userId,
    skillId: skill.id,
    skillVersionId: skillVersionId.value,
    status: "completed",
    scenario: result.value.scenario,
    transcript: result.value.transcript,
  });
  if (isErr(recorded)) return err(recorded.error);

  return ok({
    body: testRunCapability.renderers[surface].render(result.value),
    result: result.value,
  });
}
