import { z } from "zod";
import { getContainer } from "@/server/container";
import { runEvaluation } from "@/modules/skill-analysis";
import { triggeringEvalCapability } from "@/modules/triggering-eval";
import { parseSkillRequest, skillFromRequest, domainErrorResponse } from "../_shared/skill-request";

export const runtime = "nodejs";

const surfaceSchema = z.enum(["insights", "breakdown"]).default("insights");

export async function POST(request: Request): Promise<Response> {
  const container = getContainer();
  const identity = await container.auth.currentIdentity();
  if (!identity.ok) return domainErrorResponse(identity.error);
  if (identity.value === null) {
    return Response.json({ error: "Sign in to run triggering eval." }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = parseSkillRequest(body);
  const surface = surfaceSchema.safeParse(body?.surface);
  if (!parsed.ok || !surface.success) {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const skill = skillFromRequest(parsed.value, identity.value);
  const result = await runEvaluation(
    triggeringEvalCapability,
    surface.data,
    skill,
    container.modelGateway,
  );

  return result.ok ? Response.json(result.value) : domainErrorResponse(result.error);
}
