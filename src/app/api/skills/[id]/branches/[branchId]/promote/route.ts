import { getContainer } from "@/server/container";
import { createLintSummary } from "@/modules/lint";
import { isErr, SkillBranchId, SkillId } from "@/shared";
import { domainErrorResponse } from "../../../../../_shared/skill-request";

export const runtime = "nodejs";

/**
 * Set a draft as the main version (ARCHITECTURE §9.3) — the user-facing promote.
 * Append-only, last-promote-wins: the blessed pointer moves to the draft's head,
 * nothing is merged. This is the only path that changes the blessed version.
 */
export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string; branchId: string }> | { id: string; branchId: string } },
): Promise<Response> {
  const container = getContainer();
  const identity = await container.auth.currentIdentity();
  if (!identity.ok) return domainErrorResponse(identity.error);
  if (identity.value === null) {
    return Response.json({ error: "Sign in to set the main version." }, { status: 401 });
  }

  const params = await context.params;
  const promoted = await container.skills.promoteBranch({
    id: SkillId(params.id),
    userId: identity.value.userId,
    branchId: SkillBranchId(params.branchId),
  });
  if (isErr(promoted)) return domainErrorResponse(promoted.error);

  return Response.json({
    skill: {
      id: promoted.value.id,
      source: promoted.value.source,
      latestRevision: promoted.value.latestRevision,
      lintSummary: createLintSummary(promoted.value.source),
      latestVersionId: promoted.value.latestVersionId ?? null,
      createdAt: promoted.value.createdAt.toISOString(),
      updatedAt: promoted.value.updatedAt.toISOString(),
    },
  });
}
