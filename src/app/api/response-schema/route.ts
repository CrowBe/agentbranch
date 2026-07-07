import { z } from "zod";
import { getContainer } from "@/server/container";
import { runCapability } from "@/modules/skill-analysis";
import { parseResponseSchema, responseSchemaCapability } from "@/modules/response-schema";
import { domainErrorResponse } from "../_shared/skill-request";
import { invalidRequestResponse, parseJsonRequest } from "../_shared/request-body";

export const runtime = "nodejs";

const requestSchema = z.object({
  /** The raw response-schema document (JSON text). */
  document: z.string().min(1, "Send a response schema document to check."),
  surface: z.enum(["insights", "breakdown"]).default("insights"),
});

/** Quality-check a response-schema document — pure analysis, runs offline. */
export async function POST(request: Request): Promise<Response> {
  const container = getContainer();
  const identity = await container.auth.currentIdentity();
  if (!identity.ok) return domainErrorResponse(identity.error);
  if (identity.value === null) {
    return Response.json({ error: "Sign in to check a response schema." }, { status: 401 });
  }

  const body = await parseJsonRequest(request);
  if (!body.ok) return body.response;

  const parsed = requestSchema.safeParse(body.value);
  if (!parsed.success) {
    return invalidRequestResponse(parsed.error.issues[0]?.message ?? "Invalid request body.");
  }

  const source = parseResponseSchema(parsed.data.document);
  if (!source.ok) return invalidRequestResponse(source.error.message);

  const result = await runCapability(responseSchemaCapability, parsed.data.surface, source.value);
  return result.ok ? Response.json(result.value) : domainErrorResponse(result.error);
}
