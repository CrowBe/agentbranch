import { getContainer } from "@/server/container";
import { buildLoopResponse } from "@/server/build-stream";
import { SkillId } from "@/shared";
import { parseBuildRequest } from "../_shared/build-request";
import { invalidRequestResponse, parseJsonRequest } from "../_shared/request-body";

export const runtime = "nodejs";

/**
 * The build-loop route handler. Resolves identity, then streams the loop's
 * events as SSE. The build cap is no longer pre-checked here: the loop runs
 * through the **model gateway**, which gates the `build` capability against the
 * user's tier before any token is spent and surfaces `cap_reached` as a streamed
 * error event ("out of free usage today", ARCHITECTURE §8). The gateway owns the
 * Anthropic key, never the client (ARCHITECTURE §3).
 */
export async function POST(request: Request): Promise<Response> {
  const container = getContainer();

  const identity = await container.auth.currentIdentity();
  if (!identity.ok || identity.value === null) {
    return Response.json({ error: "Sign in to build a skill." }, { status: 401 });
  }

  const body = await parseJsonRequest(request);
  if (!body.ok) return body.response;

  const parsed = parseBuildRequest(body.value);
  if (!parsed.ok) return invalidRequestResponse(parsed.error);

  return buildLoopResponse(
    {
      ...parsed.value,
      currentSkillId: parsed.value.currentSkillId ? SkillId(parsed.value.currentSkillId) : undefined,
    },
    container.modelGateway,
    container.skills,
    identity.value.userId,
    container.tierFor,
  );
}
