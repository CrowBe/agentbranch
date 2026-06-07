import { getContainer } from "@/server/container";
import { runCapability } from "@/modules/skill-analysis";
import { visualiseCapability } from "@/modules/visualise";
import { parseSkillRequest, skillFromRequest, domainErrorResponse } from "../_shared/skill-request";
import { invalidRequestResponse, parseJsonRequest } from "../_shared/request-body";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const container = getContainer();
  const identity = await container.auth.currentIdentity();
  if (!identity.ok) return domainErrorResponse(identity.error);
  if (identity.value === null) {
    return Response.json({ error: "Sign in to visualise a skill." }, { status: 401 });
  }

  const body = await parseJsonRequest(request);
  if (!body.ok) return body.response;

  const parsed = parseSkillRequest(body.value);
  if (!parsed.ok) return invalidRequestResponse(parsed.error);

  const skill = skillFromRequest(parsed.value, identity.value);
  const result = await runCapability(visualiseCapability, "mermaid", skill, {
    gateway: container.modelGateway,
    tag: { kind: "account", userId: identity.value.userId, capability: "visualise" },
  });

  return result.ok ? Response.json(result.value) : domainErrorResponse(result.error);
}
