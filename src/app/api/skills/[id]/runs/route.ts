import { getContainer } from "@/server/container";
import { isErr, SkillId } from "@/shared";
import { domainErrorResponse } from "../../../_shared/skill-request";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> | { id: string } },
): Promise<Response> {
  const container = getContainer();
  const identity = await container.auth.currentIdentity();
  if (!identity.ok) return domainErrorResponse(identity.error);
  if (identity.value === null) {
    return Response.json({ error: "Sign in to load skill runs." }, { status: 401 });
  }

  const params = await context.params;
  const skillId = SkillId(params.id);
  const skill = await container.skills.findById(skillId, identity.value.userId);
  if (isErr(skill)) return domainErrorResponse(skill.error);
  if (!skill.value) return Response.json({ error: "Skill not found.", code: "not_found" }, { status: 404 });

  const [testRuns, evalRuns] = await Promise.all([
    container.testRuns.listBySkill(skillId, identity.value.userId),
    container.evalRuns.listBySkill(skillId, identity.value.userId),
  ]);
  if (isErr(testRuns)) return domainErrorResponse(testRuns.error);
  if (isErr(evalRuns)) return domainErrorResponse(evalRuns.error);

  return Response.json({
    testRuns: testRuns.value.map((run) => ({
      id: run.id,
      skillVersionId: run.skillVersionId,
      status: run.status,
      scenario: run.scenario,
      transcript: run.transcript,
      createdAt: run.createdAt.toISOString(),
    })),
    evalRuns: evalRuns.value.map((run) => ({
      id: run.id,
      skillVersionId: run.skillVersionId,
      status: run.status,
      result: run.result,
      createdAt: run.createdAt.toISOString(),
    })),
  });
}
