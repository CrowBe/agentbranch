import { z } from "zod";
import { getContainer } from "@/server/container";
import { runEvaluation } from "@/modules/skill-analysis";
import { testRunCapability } from "@/modules/test-run";
import { parseSkillRequest, skillFromRequest, domainErrorResponse } from "../_shared/skill-request";
import { invalidRequestResponse, parseJsonRequest } from "../_shared/request-body";

export const runtime = "nodejs";

const surfaceSchema = z.enum(["insights", "breakdown"]).default("insights");

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

  const skill = skillFromRequest(parsed.value, identity.value);
  const result = await runEvaluation(testRunCapability, surface.data, skill, container.modelGateway);

  return result.ok ? Response.json(result.value) : domainErrorResponse(result.error);
}
