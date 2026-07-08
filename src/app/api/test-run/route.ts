import { z } from "zod";
import { parseResponseSchema, type ResponseSchemaSource } from "@/modules/response-schema";
import { parseToolContract, type ToolContractSource } from "@/modules/tool-contract";
import { getContainer } from "@/server/container";
import {
  evaluationResponse,
  wantsSse,
  type EvaluationEquipment,
} from "@/server/evaluation-run";
import {
  parseSkillRequest,
  skillFromRequest,
  domainErrorResponse,
} from "../_shared/skill-request";
import { invalidRequestResponse, parseJsonRequest } from "../_shared/request-body";

export const runtime = "nodejs";

const surfaceSchema = z.enum(["insights", "breakdown"]).default("insights");

const EQUIPMENT_MAX = 8;

/** The optional bundle half of a test-run request (ARCHITECTURE §9.2): raw
 * tool-contract and response-schema documents, parsed through their source
 * models before the run. */
const equipmentSchema = z.object({
  toolContracts: z.array(z.string()).max(EQUIPMENT_MAX).default([]),
  responseSchemas: z.array(z.string()).max(EQUIPMENT_MAX).default([]),
});

function parseEquipment(body: unknown):
  | { readonly ok: true; readonly value: EvaluationEquipment | undefined }
  | { readonly ok: false; readonly error: string } {
  const parsed = equipmentSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return { ok: false, error: "Tool contracts and response schemas must be lists of documents." };
  }

  const toolContracts: ToolContractSource[] = [];
  for (const raw of parsed.data.toolContracts) {
    const contract = parseToolContract(raw);
    if (!contract.ok) return { ok: false, error: contract.error.message };
    toolContracts.push(contract.value);
  }
  const responseSchemas: ResponseSchemaSource[] = [];
  for (const raw of parsed.data.responseSchemas) {
    const schema = parseResponseSchema(raw);
    if (!schema.ok) return { ok: false, error: schema.error.message };
    responseSchemas.push(schema.value);
  }

  if (toolContracts.length === 0 && responseSchemas.length === 0) {
    return { ok: true, value: undefined };
  }
  return { ok: true, value: { toolContracts, responseSchemas } };
}

/** Thin HTTP adapter: parse + authenticate, then hand the run to the
 * recorded-evaluation driver (`@/server/evaluation-run`). */
export async function POST(request: Request): Promise<Response> {
  const container = getContainer();
  const identity = await container.auth.currentIdentity();
  if (!identity.ok) return domainErrorResponse(identity.error);
  if (identity.value === null) {
    return Response.json({ error: "Sign in to run a skill test." }, { status: 401 });
  }

  const body = await parseJsonRequest(request);
  if (!body.ok) return body.response;

  const parsed = parseSkillRequest(body.value);
  const surface = surfaceSchema.safeParse(
    typeof body.value === "object" && body.value !== null && "surface" in body.value
      ? body.value.surface
      : undefined,
  );
  if (!parsed.ok || !surface.success) {
    return invalidRequestResponse(parsed.ok ? "Invalid request body." : parsed.error);
  }
  const equipment = parseEquipment(
    typeof body.value === "object" && body.value !== null
      ? {
          toolContracts: "toolContracts" in body.value ? body.value.toolContracts : undefined,
          responseSchemas: "responseSchemas" in body.value ? body.value.responseSchemas : undefined,
        }
      : {},
  );
  if (!equipment.ok) return invalidRequestResponse(equipment.error);

  return evaluationResponse({
    kind: "test-run",
    surface: surface.data,
    sse: wantsSse(request),
    skill: skillFromRequest(parsed.value, identity.value),
    equipment: equipment.value,
    pin: {
      skillId: parsed.value.skillId ?? parsed.value.currentSkillId ?? null,
      branchId: parsed.value.branchId ?? null,
    },
    deps: {
      gateway: container.modelGateway,
      skills: container.skills,
      testRuns: container.testRuns,
      evalRuns: container.evalRuns,
      safetyRatings: container.safetyRatings,
      currentHarnessVersion: container.currentHarnessVersion,
    },
  });
}
