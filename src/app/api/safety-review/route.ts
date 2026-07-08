import { getContainer } from "@/server/container";
import { runRecordedEvaluation } from "@/server/evaluation-run";
import type { SafetyRating, SafetyReviewResult } from "@/modules/safety-review";
import { domainError, isErr, SkillBranchId, SkillId, type SkillVersionId } from "@/shared";
import {
  parseSkillRequest,
  skillFromRequest,
  domainErrorResponse,
} from "../_shared/skill-request";
import { invalidRequestResponse, parseJsonRequest } from "../_shared/request-body";

export const runtime = "nodejs";

/**
 * The opt-in safety rating (ARCHITECTURE §9.1). Always a manual step — nothing
 * runs it automatically, so a user never spends credits on a rating they did
 * not ask for. POST runs the safety review on the current skill (spending the
 * user's allowance) and records the rating pinned to the evaluated version;
 * GET answers whether the current head version already carries one, so the
 * client offers the scan only for an unrated version.
 *
 * Both verbs return the full rating (verdict + scores + insight) in one shape:
 * the client renders Insights and the breakdown from it locally, so switching
 * surfaces never re-runs the review.
 */
export async function POST(request: Request): Promise<Response> {
  const container = getContainer();
  const identity = await container.auth.currentIdentity();
  if (!identity.ok) return domainErrorResponse(identity.error);
  if (identity.value === null) {
    return Response.json({ error: "Sign in to run a safety rating." }, { status: 401 });
  }

  const body = await parseJsonRequest(request);
  if (!body.ok) return body.response;

  const parsed = parseSkillRequest(body.value);
  if (!parsed.ok) return invalidRequestResponse(parsed.error);

  if (!container.modelGateway.hasModel) {
    return domainErrorResponse(
      domainError(
        "model_unavailable",
        '"safety review" needs a model connection to run. Evaluation capabilities are unavailable offline.',
      ),
    );
  }

  const outcome = await runRecordedEvaluation(
    "safety-review",
    "insights",
    skillFromRequest(parsed.value, identity.value),
    {
      skillId: parsed.value.skillId ?? parsed.value.currentSkillId ?? null,
      branchId: parsed.value.branchId ?? null,
    },
    {
      gateway: container.modelGateway,
      skills: container.skills,
      testRuns: container.testRuns,
      evalRuns: container.evalRuns,
      safetyRatings: container.safetyRatings,
      currentHarnessVersion: container.currentHarnessVersion,
    },
  );
  if (isErr(outcome)) return domainErrorResponse(outcome.error);

  // The driver's kind-keyed dispatch guarantees the artifact shape per kind.
  const result = outcome.value.artifact as SafetyReviewResult;
  return Response.json({ rating: ratingBody(result) });
}

export async function GET(request: Request): Promise<Response> {
  const container = getContainer();
  const identity = await container.auth.currentIdentity();
  if (!identity.ok) return domainErrorResponse(identity.error);
  if (identity.value === null) {
    return Response.json({ error: "Sign in to load a safety rating." }, { status: 401 });
  }

  const url = new URL(request.url);
  const skillIdParam = url.searchParams.get("skillId");
  const branchIdParam = url.searchParams.get("branchId");
  if (!skillIdParam) return invalidRequestResponse("Name a skill to load its safety rating.");

  const skillId = SkillId(skillIdParam);
  const userId = identity.value.userId;

  let headVersionId: SkillVersionId | null = null;
  if (branchIdParam) {
    const versions = await container.skills.listBranchVersions(
      skillId,
      userId,
      SkillBranchId(branchIdParam),
    );
    if (isErr(versions)) return domainErrorResponse(versions.error);
    headVersionId = versions.value[0]?.id ?? null; // newest revision first
  } else {
    const skill = await container.skills.findById(skillId, userId);
    if (isErr(skill)) return domainErrorResponse(skill.error);
    headVersionId = skill.value?.latestVersionId ?? null;
  }
  if (!headVersionId) return Response.json({ rating: null });

  const rating = await container.safetyRatings.latestForVersion(skillId, userId, headVersionId);
  if (isErr(rating)) return domainErrorResponse(rating.error);

  return Response.json({
    rating: rating.value ? ratingBody(rating.value.result) : null,
  });
}

function ratingBody(result: Pick<SafetyRating["result"], "verdict" | "scores" | "insight">) {
  return {
    verdict: result.verdict,
    scores: result.scores,
    insight: result.insight,
  };
}
