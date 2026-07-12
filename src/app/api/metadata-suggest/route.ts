import { getContainer } from "@/server/container";
import { runCapability } from "@/modules/skill-analysis";
import { metadataSuggestCapability } from "@/modules/metadata-suggest";
import { parseSkillRequest, skillFromRequest, domainErrorResponse } from "../_shared/skill-request";
import { invalidRequestResponse, parseJsonRequest } from "../_shared/request-body";

export const runtime = "nodejs";

/**
 * Suggest discovery metadata (category + tags) for the skill in the request —
 * the "LLM recommended" leg of metadata authoring. Model-backed through the
 * gateway when configured, deterministic keyword fallback otherwise, so the
 * surface works offline. The response is a suggestion; writing happens through
 * the build loop's frontmatter edits or `withSkillMetadata`.
 */
export async function POST(request: Request): Promise<Response> {
  const container = getContainer();
  const identity = await container.auth.currentIdentity();
  if (!identity.ok) return domainErrorResponse(identity.error);
  if (identity.value === null) {
    return Response.json({ error: "Sign in to get metadata suggestions." }, { status: 401 });
  }

  const body = await parseJsonRequest(request);
  if (!body.ok) return body.response;

  const parsed = parseSkillRequest(body.value);
  if (!parsed.ok) return invalidRequestResponse(parsed.error);

  const skill = skillFromRequest(parsed.value, identity.value);
  const result = await runCapability(metadataSuggestCapability, "suggestions", skill, {
    gateway: container.modelGateway,
    tag: { kind: "account", userId: identity.value.userId, capability: "metadata-suggest" },
  });

  return result.ok ? Response.json(result.value) : domainErrorResponse(result.error);
}
