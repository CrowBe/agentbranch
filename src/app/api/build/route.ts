import { z } from "zod";
import { getContainer } from "@/server/container";
import { buildLoopResponse } from "@/server/build-stream";

export const runtime = "nodejs";

const bodySchema = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() }))
    .min(1),
  current: z
    .object({
      frontmatter: z.object({
        name: z.string(),
        description: z.string(),
        extra: z.record(z.string(), z.unknown()),
      }),
      body: z.string(),
    })
    .optional(),
});

/**
 * The build-loop route handler. Resolves identity, then streams the loop's
 * events as SSE. The build cap is no longer pre-checked here: the loop runs
 * through the **model gateway**, which gates the `build` capability against the
 * user's tier before any token is spent and surfaces `cap_reached` as a streamed
 * error event ("out of free usage today", ARCHITECTURE §8). The gateway owns the
 * Anthropic key, never the client (ARCHITECTURE §3).
 */
export async function POST(request: Request): Promise<Response> {
  const container = getContainer();

  const identity = await container.auth.currentIdentity();
  if (!identity.ok || identity.value === null) {
    return Response.json({ error: "Sign in to build a skill." }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  return buildLoopResponse(parsed.data, container.modelGateway, identity.value.userId);
}
