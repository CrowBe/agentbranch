import { getContainer } from "@/server/container";
import { domainErrorResponse } from "../_shared/skill-request";

export const runtime = "nodejs";

/** The user's saved agent configurations (ARCHITECTURE §10). Owner-scoped. */
export async function GET(): Promise<Response> {
  const container = getContainer();
  const identity = await container.auth.currentIdentity();
  if (!identity.ok) return domainErrorResponse(identity.error);
  if (identity.value === null) {
    return Response.json({ error: "Sign in to list agent configurations." }, { status: 401 });
  }

  const listed = await container.agentConfigurations.listByUser(identity.value.userId);
  return listed.ok
    ? Response.json({
        // The list is an index, not a payload: names and identity only. A
        // saved snapshot carries somebody's whole configuration, so it is
        // fetched deliberately, one at a time.
        configurations: listed.value.map((configuration) => ({
          id: configuration.id,
          name: configuration.name,
          revision: configuration.mainVersion.revision,
          createdAt: configuration.createdAt,
          updatedAt: configuration.updatedAt,
        })),
      })
    : domainErrorResponse(listed.error);
}
