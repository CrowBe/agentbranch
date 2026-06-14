import { z } from "zod";
import { getContainer } from "@/server/container";
import { isAdmin } from "@/modules/auth";
import { isErr, type Result, type DomainError } from "@/shared";
import type { ModelSelection, RouterSnapshot } from "@/modules/model-router";
import { domainErrorResponse } from "../_shared/skill-request";
import { invalidRequestResponse, parseJsonRequest } from "../_shared/request-body";

export const runtime = "nodejs";

/**
 * Model console API — reads the secret-free provider registry + active selection,
 * and switches the active provider/model or stores a bring-your-own credential at
 * runtime (ARCHITECTURE §4 routing). Mutations route through the model router;
 * keys are accepted but never echoed back (the snapshot is secret-free).
 *
 * The selection + credentials apply to the whole running instance, so this is an
 * admin surface: when auth is configured, only an admin (config allowlist) may
 * read or change it — a plain signed-in user gets 403. With no auth configured
 * (single-tenant dev box) it is open. No allowlist in a deployed environment
 * means it is locked (fail-safe), not open to everyone.
 */

const modelIdsSchema = z
  .object({
    default: z.string().min(1),
    classify: z.string().min(1),
    generate: z.string().min(1),
    runAgent: z.string().min(1),
    streamAgent: z.string().min(1),
  })
  .partial();

const commandSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("select"),
    providerId: z.string().min(1),
    modelIds: modelIdsSchema.optional(),
  }),
  z.object({
    action: z.literal("set-credential"),
    providerId: z.string().min(1),
    apiKey: z.string().min(1),
    baseUrl: z.string().url().optional(),
    modelIds: modelIdsSchema.optional(),
  }),
  z.object({
    action: z.literal("clear-credential"),
    providerId: z.string().min(1),
  }),
]);

export async function GET(): Promise<Response> {
  const container = getContainer();
  const gate = await requireAdmin();
  if (gate) return gate;
  return Response.json(container.modelRouter.snapshot());
}

export async function POST(request: Request): Promise<Response> {
  const container = getContainer();
  const gate = await requireAdmin();
  if (gate) return gate;

  const body = await parseJsonRequest(request);
  if (!body.ok) return body.response;

  const parsed = commandSchema.safeParse(body.value);
  if (!parsed.success) return invalidRequestResponse("Invalid model console command.");

  const command = parsed.data;
  const router = container.modelRouter;
  let result: Result<RouterSnapshot, DomainError>;
  if (command.action === "select") {
    const selection: ModelSelection = { providerId: command.providerId, modelIds: command.modelIds };
    result = router.setActive(selection);
  } else if (command.action === "set-credential") {
    result = router.setCredential({
      providerId: command.providerId,
      apiKey: command.apiKey,
      baseUrl: command.baseUrl,
      modelIds: command.modelIds,
    });
  } else {
    result = router.clearCredential(command.providerId);
  }

  if (isErr(result)) return domainErrorResponse(result.error);
  return Response.json(result.value);
}

/**
 * Authorize an admin caller; null when they may proceed. 401 signed-out, 403 a
 * non-admin while auth is configured. Open on a no-auth dev box; locked when auth
 * is on but no admin allowlist is set (fail-safe).
 */
async function requireAdmin(): Promise<Response | null> {
  const container = getContainer();
  const identity = await container.auth.currentIdentity();
  if (!identity.ok) return domainErrorResponse(identity.error);
  if (identity.value === null) {
    return Response.json({ error: "Sign in to manage models." }, { status: 401 });
  }
  if (!container.config.flags.hasAuth) return null;
  if (isAdmin(identity.value, container.config.admin)) return null;
  return Response.json(
    { error: "Model settings are restricted to administrators." },
    { status: 403 },
  );
}
