import { z } from "zod";
import { getContainer } from "@/server/container";
import { runCapability } from "@/modules/skill-analysis";
import { parseSubagentDefinition, subagentDefinitionCapability } from "@/modules/subagent-definition";
import { domainErrorResponse } from "../_shared/skill-request";
import { invalidRequestResponse, parseJsonRequest } from "../_shared/request-body";

export const runtime = "nodejs";
const requestSchema = z.object({ document: z.string().min(1, "Send a subagent definition to check."), surface: z.enum(["insights", "breakdown"]).default("insights") });

export async function POST(request: Request): Promise<Response> {
  const container = getContainer();
  const identity = await container.auth.currentIdentity();
  if (!identity.ok) return domainErrorResponse(identity.error);
  if (!identity.value) return Response.json({ error: "Sign in to check a subagent definition." }, { status: 401 });
  const body = await parseJsonRequest(request);
  if (!body.ok) return body.response;
  const parsed = requestSchema.safeParse(body.value);
  if (!parsed.success) return invalidRequestResponse(parsed.error.issues[0]?.message ?? "Invalid request body.");
  const source = parseSubagentDefinition(parsed.data.document);
  if (!source.ok) return invalidRequestResponse(source.error.message);
  const result = await runCapability(subagentDefinitionCapability, parsed.data.surface, source.value);
  return result.ok ? Response.json(result.value) : domainErrorResponse(result.error);
}
