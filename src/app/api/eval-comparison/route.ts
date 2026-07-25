import { compareEvalRuns } from "@/modules/eval-comparison";
import { getContainer } from "@/server/container";
import { EvalRunId, isErr } from "@/shared";
import { domainErrorResponse } from "../_shared/skill-request";

export const runtime = "nodejs";

/** Deterministic, user-scoped derived comparison; no comparison row is stored. */
export async function GET(request: Request): Promise<Response> {
  const container = getContainer();
  const identity = await container.auth.currentIdentity();
  if (isErr(identity)) return domainErrorResponse(identity.error);
  if (identity.value === null) {
    return Response.json({ error: "Sign in to compare evaluation runs." }, { status: 401 });
  }
  const query = new URL(request.url).searchParams;
  const left = query.get("leftRunId");
  const right = query.get("rightRunId");
  const methodVersion = query.get("methodVersion") ?? "1";
  if (!left || !right || methodVersion !== "1") {
    return Response.json(
      { error: "leftRunId, rightRunId, and comparison method version 1 are required." },
      { status: 400 },
    );
  }
  const comparison = await compareEvalRuns(
    container.evalRuns,
    identity.value.userId,
    EvalRunId(left),
    EvalRunId(right),
  );
  return isErr(comparison)
    ? domainErrorResponse(comparison.error)
    : Response.json(comparison.value);
}
