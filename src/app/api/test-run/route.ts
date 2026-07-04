import { z } from "zod";
import { getContainer } from "@/server/container";
import { evaluationResponse, wantsSse } from "@/server/evaluation-run";
import {
  parseSkillRequest,
  skillFromRequest,
  domainErrorResponse,
} from "../_shared/skill-request";
import { invalidRequestResponse, parseJsonRequest } from "../_shared/request-body";

export const runtime = "nodejs";

const surfaceSchema = z.enum(["insights", "breakdown"]).default("insights");

/** Thin HTTP adapter: parse + authenticate, then hand the run to the
 * recorded-evaluation driver (`@/server/evaluation-run`). */
export async function POST(request: Request): Promise<Response> {
  const container = getContainer();
  const identity = await container.auth.currentIdentity();
  if (!identity.ok) return domainErrorResponse(identity.error);
  if (identity.value === null) {
    return Response.json({ error: "Sign in to run a skill test." }, { status: 401 });
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

  return evaluationResponse({
    kind: "test-run",
    surface: surface.data,
    sse: wantsSse(request),
    skill: skillFromRequest(parsed.value, identity.value),
    pin: {
      skillId: parsed.value.skillId ?? parsed.value.currentSkillId ?? null,
      branchId: parsed.value.branchId ?? null,
    },
    deps: {
      gateway: container.modelGateway,
      skills: container.skills,
      testRuns: container.testRuns,
      evalRuns: container.evalRuns,
      currentHarnessVersion: container.currentHarnessVersion,
    },
  });
}
