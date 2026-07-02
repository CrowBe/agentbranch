import { getContainer } from "@/server/container";
import type { SkillBranch } from "@/modules/skill";
import { isErr, SkillId, type UserId } from "@/shared";
import type { SkillRepository } from "@/modules/skill";
import { domainErrorResponse } from "../../../_shared/skill-request";
import { branchDetail } from "./branch-response";

export const runtime = "nodejs";

/**
 * Drafts of a skill (ARCHITECTURE §9.3). A draft is a branch of revisions that
 * accumulates without moving the blessed main pointer; the UI surfaces it so an
 * un-promoted draft from a prior session is never stranded. `branch`/`promote`
 * are internal terms — user copy says draft / main version.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> | { id: string } },
): Promise<Response> {
  const container = getContainer();
  const identity = await container.auth.currentIdentity();
  if (!identity.ok) return domainErrorResponse(identity.error);
  if (identity.value === null) {
    return Response.json({ error: "Sign in to view drafts." }, { status: 401 });
  }

  const params = await context.params;
  const id = SkillId(params.id);
  const branches = await container.skills.listBranches(id, identity.value.userId);
  if (isErr(branches)) return domainErrorResponse(branches.error);

  const summaries = await Promise.all(
    branches.value.map((branch) => summariseBranch(container.skills, id, identity.value!.userId, branch)),
  );
  return Response.json({ branches: summaries });
}

/** Start a fresh draft off the skill's current main version. */
export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> | { id: string } },
): Promise<Response> {
  const container = getContainer();
  const identity = await container.auth.currentIdentity();
  if (!identity.ok) return domainErrorResponse(identity.error);
  if (identity.value === null) {
    return Response.json({ error: "Sign in to start a draft." }, { status: 401 });
  }

  const params = await context.params;
  const id = SkillId(params.id);
  const created = await container.skills.createBranch({ id, userId: identity.value.userId });
  if (isErr(created)) return domainErrorResponse(created.error);

  const versions = await container.skills.listBranchVersions(id, identity.value.userId, created.value.id);
  if (isErr(versions)) return domainErrorResponse(versions.error);
  const head = versions.value[0];
  if (!head) {
    return Response.json({ error: "The draft has no revisions.", code: "invalid_operation" }, { status: 409 });
  }

  return Response.json({ branch: branchDetail(created.value, head) }, { status: 201 });
}

async function summariseBranch(
  skills: SkillRepository,
  id: ReturnType<typeof SkillId>,
  userId: UserId,
  branch: SkillBranch,
): Promise<{
  readonly id: string;
  readonly isMain: boolean;
  readonly status: SkillBranch["status"];
  readonly ordinal: number;
  readonly revision: number | null;
  readonly name: string | null;
  readonly description: string | null;
  readonly updatedAt: string;
}> {
  const versions = await skills.listBranchVersions(id, userId, branch.id);
  const head = versions.ok ? versions.value[0] : undefined;
  return {
    id: branch.id,
    isMain: branch.isMain,
    status: branch.status,
    ordinal: branch.ordinal,
    revision: head?.revision ?? null,
    name: head?.source.frontmatter.name ?? null,
    description: head?.source.frontmatter.description ?? null,
    updatedAt: branch.updatedAt.toISOString(),
  };
}
