import { z } from "zod";
import { getContainer } from "@/server/container";
import { buildLoopResponse } from "@/server/build-stream";
import { checkCap } from "@/modules/usage";

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
 * The build-loop route handler — owns the Anthropic key, never the client
 * (ARCHITECTURE §3). Resolves identity, checks the build cap, then streams the
 * loop's events as SSE.
 */
export async function POST(request: Request): Promise<Response> {
  const container = getContainer();

  const identity = await container.auth.currentIdentity();
  if (!identity.ok || identity.value === null) {
    return Response.json({ error: "Sign in to build a skill." }, { status: 401 });
  }

  const usage = await container.usage.get(identity.value.userId);
  if (usage.ok) {
    const decision = checkCap(usage.value, "free", "build");
    if (!decision.allowed) {
      return Response.json({ error: decision.reason }, { status: 429 });
    }
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  return buildLoopResponse(parsed.data, container.modelProvider);
}
