import { z } from "zod";
import { getContainer } from "@/server/container";
import { responseSchemaLoopResponse } from "@/server/response-schema-stream";
import { LIMIT_MESSAGES, MESSAGES_MAX, MESSAGE_CONTENT_MAX } from "@/shared";
import { parseResponseSchema } from "@/modules/response-schema";
import { invalidRequestResponse, parseJsonRequest } from "../../_shared/request-body";

export const runtime = "nodejs";

const requestSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(MESSAGE_CONTENT_MAX, LIMIT_MESSAGES.messageContent),
      }),
    )
    .min(1)
    .max(MESSAGES_MAX, LIMIT_MESSAGES.messages),
  /** The schema being revised — raw JSON text (absent on a first draft). */
  current: z.string().optional(),
});

/**
 * The response-schema authoring route (issue #151): the build loop's shape for
 * the first equipment primitive. Resolves identity, then streams the loop's
 * events as SSE. The model gateway gates the `build` capability against the
 * user's tier before any token is spent; the finished document is not
 * persisted here — the client workspace keeps it for the session, like a
 * pasted schema (ARCHITECTURE §9.2).
 */
export async function POST(request: Request): Promise<Response> {
  const container = getContainer();

  const identity = await container.auth.currentIdentity();
  if (!identity.ok || identity.value === null) {
    return Response.json({ error: "Sign in to build a response schema." }, { status: 401 });
  }

  const body = await parseJsonRequest(request);
  if (!body.ok) return body.response;

  const parsed = requestSchema.safeParse(body.value);
  if (!parsed.success) {
    return invalidRequestResponse(parsed.error.issues[0]?.message ?? "Invalid request body.");
  }

  let current;
  if (parsed.data.current !== undefined) {
    const source = parseResponseSchema(parsed.data.current);
    if (!source.ok) return invalidRequestResponse(source.error.message);
    current = source.value;
  }

  return responseSchemaLoopResponse(
    { messages: parsed.data.messages, current },
    container.modelGateway,
    identity.value.userId,
  );
}
