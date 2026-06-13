import { getContainer } from "@/server/container";
import { checkSkillCreateCap, parseSkillMd } from "@/modules/skill";
import { REQUEST_RATE_LIMIT } from "@/modules/usage";
import { createHeroArtifact, renderedRenderer, sourceRenderer } from "@/modules/hero";
import { createLintReport, lintBreakdownRenderer, lintInsightsRenderer } from "@/modules/lint";
import { isErr } from "@/shared";
import { domainErrorResponse } from "../_shared/skill-request";
import { invalidRequestResponse, parseTextRequest } from "../_shared/request-body";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const container = getContainer();

  const identity = await container.auth.currentIdentity();
  if (!identity.ok) return domainErrorResponse(identity.error);
  if (identity.value === null) {
    return Response.json({ error: "Sign in to import a skill." }, { status: 401 });
  }

  const rate = await container.requestRateLimiter.consume(
    identity.value.userId,
    "import",
    REQUEST_RATE_LIMIT,
  );
  if (isErr(rate)) return domainErrorResponse(rate.error);
  if (!rate.value.allowed) {
    return domainErrorResponse({ tag: "cap_reached", message: rate.value.reason });
  }

  const body = await parseTextRequest(request);
  if (!body.ok) return body.response;

  const parsed = parseSkillMd(body.value);
  if (isErr(parsed)) {
    return invalidRequestResponse(
      `This doesn't look like a valid SKILL.md yet - ${parsed.error.message}`,
    );
  }

  const tier = await container.tierFor(identity.value.userId);
  const skillCap = await checkSkillCreateCap({
    skills: container.skills,
    userId: identity.value.userId,
    tier,
  });
  if (isErr(skillCap)) return domainErrorResponse(skillCap.error);

  const saved = await container.skills.create({
    userId: identity.value.userId,
    source: parsed.value,
  });
  if (isErr(saved)) return domainErrorResponse(saved.error);

  const artifact = createHeroArtifact(saved.value.source);
  const lint = createLintReport(saved.value);
  return Response.json({
    skill: {
      id: saved.value.id,
      source: saved.value.source,
      latestRevision: saved.value.latestRevision,
    },
    rendered: renderedRenderer.render(artifact),
    source: sourceRenderer.render(artifact),
    lint: {
      insights: lintInsightsRenderer.render(lint),
      breakdown: lintBreakdownRenderer.render(lint),
    },
  });
}
