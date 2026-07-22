import { z } from "zod";
import { getContainer } from "@/server/container";
import { subagentDefinitionLoopResponse } from "@/server/subagent-definition-stream";
import { LIMIT_MESSAGES, MESSAGES_MAX, MESSAGE_CONTENT_MAX } from "@/shared";
import { parseSubagentDefinition } from "@/modules/subagent-definition";
import { invalidRequestResponse, parseJsonRequest } from "../../_shared/request-body";

export const runtime = "nodejs";
const requestSchema = z.object({ messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(MESSAGE_CONTENT_MAX, LIMIT_MESSAGES.messageContent) })).min(1).max(MESSAGES_MAX, LIMIT_MESSAGES.messages), current: z.string().optional() });
export async function POST(request: Request): Promise<Response> {
  const container = getContainer(); const identity = await container.auth.currentIdentity();
  if (!identity.ok || !identity.value) return Response.json({ error: "Sign in to build a subagent definition." }, { status: 401 });
  const body = await parseJsonRequest(request); if (!body.ok) return body.response;
  const parsed = requestSchema.safeParse(body.value); if (!parsed.success) return invalidRequestResponse(parsed.error.issues[0]?.message ?? "Invalid request body.");
  const current = parsed.data.current ? parseSubagentDefinition(parsed.data.current) : null; if (current && !current.ok) return invalidRequestResponse(current.error.message);
  return subagentDefinitionLoopResponse({ messages: parsed.data.messages, current: current?.ok ? current.value : undefined }, container.modelGateway, identity.value.userId);
}
