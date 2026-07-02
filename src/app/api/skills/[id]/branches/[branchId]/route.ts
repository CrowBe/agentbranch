import { getContainer } from "@/server/container";
import { isErr, SkillBranchId, SkillId } from "@/shared";
import { domainErrorResponse } from "../../../../_shared/skill-request";
import { branchDetail } from "../branch-response";

export const runtime = "nodejs";

/** Resume a draft — its head source + revision history (ARCHITECTURE §9.3). */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string; branchId: string }> | { id: string; branchId: string } },
): Promise<Response> {
  const container = getContainer();
  const identity = await container.auth.currentIdentity();
  if (!identity.ok) return domainErrorResponse(identity.error);
  if (identity.value === null) {
    return Response.json({ error: "Sign in to open a draft." }, { status: 401 });
  }

  const params = await context.params;
  const id = SkillId(params.id);
  const branchId = SkillBranchId(params.branchId);

  const branches = await container.skills.listBranches(id, identity.value.userId);
  if (isErr(branches)) return domainErrorResponse(branches.error);
  const branch = branches.value.find((b) => b.id === branchId);
  if (!branch || branch.status === "discarded") {
    return Response.json({ error: "Draft not found.", code: "not_found" }, { status: 404 });
  }

  const versions = await container.skills.listBranchVersions(id, identity.value.userId, branchId);
  if (isErr(versions)) return domainErrorResponse(versions.error);
  const head = versions.value[0];
  if (!head) {
    return Response.json({ error: "The draft has no revisions.", code: "not_found" }, { status: 404 });
  }

  return Response.json({
    branch: branchDetail(branch, head),
    versions: versions.value.map((version) => ({
      id: version.id,
      revision: version.revision,
      source: version.source,
      lintSummary: version.lintSummary ?? null,
      createdAt: version.createdAt.toISOString(),
    })),
  });
}

/** Discard a draft (ARCHITECTURE §9.3). The main version cannot be discarded. */
export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string; branchId: string }> | { id: string; branchId: string } },
): Promise<Response> {
  const container = getContainer();
  const identity = await container.auth.currentIdentity();
  if (!identity.ok) return domainErrorResponse(identity.error);
  if (identity.value === null) {
    return Response.json({ error: "Sign in to discard a draft." }, { status: 401 });
  }

  const params = await context.params;
  const result = await container.skills.discardBranch({
    id: SkillId(params.id),
    userId: identity.value.userId,
    branchId: SkillBranchId(params.branchId),
  });

  return result.ok ? new Response(null, { status: 204 }) : domainErrorResponse(result.error);
}
