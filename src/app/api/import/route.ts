import { getContainer } from "@/server/container";
import { checkSkillCreateCap, parseSkillMd } from "@/modules/skill";
import { REQUEST_RATE_LIMIT } from "@/modules/usage";
import { createHeroArtifact, renderedRenderer, sourceRenderer } from "@/modules/hero";
import {
  createLintReport,
  createLintSummary,
  lintBreakdownRenderer,
  lintInsightsRenderer,
} from "@/modules/lint";
import { isErr } from "@/shared";
import { domainErrorResponse } from "../_shared/skill-request";
import { invalidRequestResponse, parseJsonRequest, parseTextRequest } from "../_shared/request-body";

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

  const body = await importSource(request, container.skillImportFetcher);
  if (!body.ok) return body.response;

  const parsed = parseSkillMd(body.value);
  if (isErr(parsed)) {
    return invalidRequestResponse(
      `This doesn't look like a valid SKILL.md yet - ${parsed.error.message}`,
    );
  }

  const skillCap = await checkSkillCreateCap({
    skills: container.skills,
    userId: identity.value.userId,
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
      lintSummary: createLintSummary(saved.value.source),
    },
    rendered: renderedRenderer.render(artifact),
    source: sourceRenderer.render(artifact),
    lint: {
      insights: lintInsightsRenderer.render(lint),
      breakdown: lintBreakdownRenderer.render(lint),
    },
  });
}

async function importSource(
  request: Request,
  fetcher: import("@/modules/skill-import").SkillImportFetcher,
): Promise<import("../_shared/request-body").TextRequestResult> {
  if (request.headers.get("content-type")?.includes("application/json")) {
    const body = await parseJsonRequest(request);
    if (!body.ok) return body;
    if (!isUrlImportRequest(body.value)) {
      return { ok: false, response: invalidRequestResponse("Send a GitHub URL to import.") };
    }

    const fetched = await fetcher.fetchSkillMd(body.value.url);
    return fetched.ok
      ? { ok: true, value: fetched.value }
      : { ok: false, response: invalidRequestResponse(fetched.error.message) };
  }

  return parseTextRequest(request);
}

function isUrlImportRequest(value: unknown): value is { readonly url: string } {
  return (
    value !== null &&
    typeof value === "object" &&
    "url" in value &&
    typeof value.url === "string" &&
    value.url.trim().length > 0
  );
}
