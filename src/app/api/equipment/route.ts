import { z } from "zod";
import { getContainer } from "@/server/container";
import { runCapability } from "@/modules/skill-analysis";
import { parseResponseSchema, responseSchemaCapability, responseSchemaName } from "@/modules/response-schema";
import { parseToolContract, toolContractCapability } from "@/modules/tool-contract";
import { domainErrorResponse } from "../_shared/skill-request";
import { invalidRequestResponse, parseJsonRequest } from "../_shared/request-body";

export const runtime = "nodejs";

const requestSchema = z.object({
  kind: z.enum(["response-schema", "tool-contract"]),
  document: z.string().min(1),
  surface: z.enum(["insights", "breakdown"]).default("insights"),
});

export async function GET(): Promise<Response> {
  const container = getContainer();
  const identity = await container.auth.currentIdentity();
  if (!identity.ok) return domainErrorResponse(identity.error);
  if (!identity.value) return Response.json({ error: "Sign in to list equipment." }, { status: 401 });
  const listed = await container.equipment.list(identity.value.userId);
  return listed.ok ? Response.json({ equipment: listed.value }) : domainErrorResponse(listed.error);
}

export async function POST(request: Request): Promise<Response> {
  const container = getContainer();
  const identity = await container.auth.currentIdentity();
  if (!identity.ok) return domainErrorResponse(identity.error);
  if (!identity.value) return Response.json({ error: "Sign in to save equipment." }, { status: 401 });
  const body = await parseJsonRequest(request);
  if (!body.ok) return body.response;
  const parsed = requestSchema.safeParse(body.value);
  if (!parsed.success) return invalidRequestResponse(parsed.error.issues[0]?.message ?? "Invalid equipment.");

  const contract = parsed.data.kind === "tool-contract" ? parseToolContract(parsed.data.document) : null;
  const schema = parsed.data.kind === "response-schema" ? parseResponseSchema(parsed.data.document) : null;
  const sourceError = contract && !contract.ok ? contract.error : schema && !schema.ok ? schema.error : null;
  if (sourceError) return invalidRequestResponse(sourceError.message);
  if (!contract?.ok && !schema?.ok) return invalidRequestResponse("Equipment could not be parsed.");
  let name: string;
  let result;
  if (contract?.ok) {
    name = contract.value.name;
    result = await runCapability(toolContractCapability, parsed.data.surface, contract.value);
  } else if (schema?.ok) {
    name = responseSchemaName(schema.value);
    result = await runCapability(responseSchemaCapability, parsed.data.surface, schema.value);
  } else {
    return invalidRequestResponse("Equipment could not be parsed.");
  }
  if (!result.ok) return domainErrorResponse(result.error);
  if (!name.trim()) return invalidRequestResponse("Equipment needs a name before it can be saved.");
  const saved = await container.equipment.save({ userId: identity.value.userId, kind: parsed.data.kind, name, document: parsed.data.document });
  return saved.ok ? Response.json({ equipment: saved.value, quality: result.value }) : domainErrorResponse(saved.error);
}
