import { z } from "zod";
import { getContainer } from "@/server/container";
import { toolContractLoopResponse } from "@/server/tool-contract-stream";
import { LIMIT_MESSAGES, MESSAGES_MAX, MESSAGE_CONTENT_MAX } from "@/shared";
import { parseToolContract } from "@/modules/tool-contract";
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
  /** The contract being revised — raw JSON text (absent on a first draft). */
  current: z.string().optional(),
});

/**
 * The tool-contract authoring route: the build loop's shape for the second
 * equipment primitive. Resolves identity, then streams the loop's events as
 * SSE. The model gateway gates the `build` capability before any token is
 * spent; the finished contract is session-kept by the workspace.
 */
export async function POST(request: Request): Promise<Response> {
  const container = getContainer();

  const identity = await container.auth.currentIdentity();
  if (!identity.ok || identity.value === null) {
    return Response.json({ error: "Sign in to build a tool contract." }, { status: 401 });
  }

  const body = await parseJsonRequest(request);
  if (!body.ok) return body.response;

  const parsed = requestSchema.safeParse(body.value);
  if (!parsed.success) {
    return invalidRequestResponse(parsed.error.issues[0]?.message ?? "Invalid request body.");
  }

  let current;
  if (parsed.data.current !== undefined) {
    const source = parseToolContract(parsed.data.current);
    if (!source.ok) return invalidRequestResponse(source.error.message);
    current = source.value;
  }

  return toolContractLoopResponse(
    { messages: parsed.data.messages, current },
    container.modelGateway,
    identity.value.userId,
  );
}
