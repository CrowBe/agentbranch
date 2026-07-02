import { z } from "zod";
import { getContainer } from "@/server/container";
import { runTriggeringEval, triggeringEvalCapability } from "@/modules/triggering-eval";
import type { AuthIdentity } from "@/modules/auth";
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
    return Response.json({ error: "Sign in to run triggering eval." }, { status: 401 });
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
        `"${triggeringEvalCapability.name}" needs a model connection to run. Test runs and triggering evals are unavailable offline.`,
      ),
    );
  }

  if (wantsSse(request)) {
    return evaluationStreamResponse(
      (emit) => runTriggering(parsed.value, authIdentity, surface.data, emit),
      surface.data,
    );
  }

  const rendered = await runTriggering(parsed.value, authIdentity, surface.data);
  if (isErr(rendered)) return domainErrorResponse(rendered.error);
  return Response.json(rendered.value.body);
}

async function runTriggering(
  request: ParsedSkillRequest,
  identity: AuthIdentity,
  surface: EvaluationSurface,
  emit?: EvaluationEmit,
): Promise<Result<EvaluationResponse, DomainError>> {
  const container = getContainer();
  const skill = skillFromRequest(request, identity);
  emit?.({ event: "eval-progress", data: { message: "Building prompt battery." } });
  const result = await runTriggeringEval(
    skill,
    container.modelGateway,
    { kind: "account", userId: skill.userId, capability: "triggering-eval" },
    {
      onCase: ({ index, total, result: item }) =>
        emit?.({
          event: "eval-case",
          data: {
            index,
            total,
            prompt: item.prompt,
            expected: item.expected,
            actual: item.actual,
            pass: item.pass,
            rationale: item.rationale,
          },
        }),
    },
  );
  if (isErr(result)) return err(result.error);

  emit?.({ event: "eval-progress", data: { message: "Recording triggering eval." } });
  const skillVersionId = await resolvePinnedVersionId(container.skills, request, identity.userId);
  if (isErr(skillVersionId)) return err(skillVersionId.error);
  const harnessVersion = await container.currentHarnessVersion();
  if (isErr(harnessVersion)) return err(harnessVersion.error);

  const recorded = await container.evalRuns.record({
    userId: skill.userId,
    skillId: skill.id,
    skillVersionId: skillVersionId.value,
    harnessVersionId: harnessVersion.value.id,
    status: result.value.passed ? "passed" : "failed",
    result: result.value,
  });
  if (isErr(recorded)) return err(recorded.error);

  return ok({
    body: triggeringEvalCapability.renderers[surface].render(result.value),
    result: result.value,
  });
}
