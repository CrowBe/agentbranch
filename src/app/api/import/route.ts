import { z } from "zod";
import { getContainer } from "@/server/container";
import { checkSkillCreateCap, parseSkillMd } from "@/modules/skill";
import { REQUEST_RATE_LIMIT } from "@/modules/usage";
import { createHeroArtifact, renderedRenderer, sourceRenderer } from "@/modules/hero";
import { classifyImportDocument, type ImportPrimitiveKind } from "@/modules/import";
import { runCapability } from "@/modules/skill-analysis";
import { parseResponseSchema, responseSchemaCapability, responseSchemaName } from "@/modules/response-schema";
import { parseToolContract, toolContractCapability } from "@/modules/tool-contract";
import { parseSubagentDefinition, subagentDefinitionCapability } from "@/modules/subagent-definition";
import {
  createLintReport,
  createLintSummary,
  lintBreakdownRenderer,
  lintInsightsRenderer,
} from "@/modules/lint";
import { isErr, type UserId } from "@/shared";
import { domainErrorResponse } from "../_shared/skill-request";
import { invalidRequestResponse, parseJsonRequest, parseTextRequest } from "../_shared/request-body";

export const runtime = "nodejs";

/**
 * The import ladder's lower two rungs (ARCHITECTURE §10). Rung one lands a
 * single building block; rung two lands a set that belongs together. The top
 * rung — a whole agent configuration — is its own route, because it previews
 * before it saves.
 */
const primitiveKind = z.enum(["skill", "response-schema", "tool-contract", "subagent-definition"]);

const requestSchema = z.discriminatedUnion("tier", [
  z.object({
    tier: z.literal("primitive"),
    document: z.string().min(1),
    /** Set when the user has already resolved an ambiguous classification. */
    kind: primitiveKind.optional(),
  }),
  z.object({
    tier: z.literal("related-primitives"),
    documents: z
      .array(z.object({ document: z.string().min(1), kind: primitiveKind.optional() }))
      .min(1)
      .max(20),
  }),
]);

/** The legacy shape: a public GitHub SKILL.md URL. Rung one, fetched for you. */
const urlSchema = z.object({ url: z.string().min(1) });

type LandedSkill = {
  readonly kind: "skill";
  readonly name: string;
  readonly payload: Record<string, unknown>;
};
type LandedEquipment = {
  readonly kind: Exclude<ImportPrimitiveKind, "skill">;
  readonly name: string;
  readonly payload: Record<string, unknown>;
};
type Landed = LandedSkill | LandedEquipment;
type LandFailure = { readonly response: Response };

export async function POST(request: Request): Promise<Response> {
  const container = getContainer();

  const identity = await container.auth.currentIdentity();
  if (!identity.ok) return domainErrorResponse(identity.error);
  if (identity.value === null) {
    return Response.json({ error: "Sign in to import." }, { status: 401 });
  }
  const userId = identity.value.userId;

  const rate = await container.requestRateLimiter.consume(userId, "import", REQUEST_RATE_LIMIT);
  if (isErr(rate)) return domainErrorResponse(rate.error);
  if (!rate.value.allowed) {
    return domainErrorResponse({ tag: "cap_reached", message: rate.value.reason });
  }

  if (!request.headers.get("content-type")?.includes("application/json")) {
    // A raw body is the plainest rung-one case: "here is my SKILL.md".
    const text = await parseTextRequest(request);
    if (!text.ok) return text.response;
    return landOne(container, userId, text.value, "skill");
  }

  const body = await parseJsonRequest(request);
  if (!body.ok) return body.response;

  const url = urlSchema.safeParse(body.value);
  if (url.success) {
    const fetched = await container.skillImportFetcher.fetchSkillMd(url.data.url);
    if (!fetched.ok) return invalidRequestResponse(fetched.error.message);
    return landOne(container, userId, fetched.value, "skill");
  }

  const parsed = requestSchema.safeParse(body.value);
  if (!parsed.success) {
    return invalidRequestResponse("Send a document to import, or a GitHub URL.");
  }

  if (parsed.data.tier === "primitive") {
    return landOne(container, userId, parsed.data.document, parsed.data.kind);
  }
  return landSet(container, userId, parsed.data.documents);
}

/** Rung one: one building block, landed in the store its kind belongs to. */
async function landOne(
  container: ReturnType<typeof getContainer>,
  userId: UserId,
  document: string,
  kind: ImportPrimitiveKind | undefined,
): Promise<Response> {
  const classified = classifyImportDocument(document, kind ? { candidates: [kind] } : {});
  if (!classified.ok) {
    // Keep the single-kind message specific — a user who said "this is a
    // SKILL.md" is owed the SKILL.md parser's own complaint.
    if (kind === "skill") {
      const reparsed = parseSkillMd(document);
      if (isErr(reparsed)) {
        return invalidRequestResponse(
          `This doesn't look like a valid SKILL.md yet - ${reparsed.error.message}`,
        );
      }
    }
    return invalidRequestResponse(classified.message);
  }

  const landed = await land(container, userId, document, classified.kind);
  if ("response" in landed) return landed.response;
  return Response.json({
    ...landed.payload,
    kind: landed.kind,
    // Other readings the same bytes support, so the UI can offer a correction
    // instead of the user discovering it filed under the wrong primitive.
    alternatives: classified.alternatives,
  });
}

/**
 * Rung two: several documents that belong together. Each lands on its own
 * terms; one bad document reports itself and does not discard the rest.
 */
async function landSet(
  container: ReturnType<typeof getContainer>,
  userId: UserId,
  documents: readonly { readonly document: string; readonly kind?: ImportPrimitiveKind }[],
): Promise<Response> {
  const imported: Record<string, unknown>[] = [];
  const skipped: { readonly message: string }[] = [];

  for (const entry of documents) {
    const classified = classifyImportDocument(
      entry.document,
      entry.kind ? { candidates: [entry.kind] } : {},
    );
    if (!classified.ok) {
      skipped.push({ message: classified.message });
      continue;
    }
    const landed = await land(container, userId, entry.document, classified.kind);
    if ("response" in landed) {
      const body = (await landed.response.json().catch(() => null)) as { error?: string } | null;
      skipped.push({
        message: body?.error ?? `${classified.name} could not be imported.`,
      });
      continue;
    }
    imported.push({ ...landed.payload, kind: landed.kind, name: landed.name });
  }

  if (imported.length === 0) {
    return invalidRequestResponse(
      skipped[0]?.message ?? "None of those documents could be imported.",
    );
  }
  return Response.json({ tier: "related-primitives", imported, skipped });
}

async function land(
  container: ReturnType<typeof getContainer>,
  userId: UserId,
  document: string,
  kind: ImportPrimitiveKind,
): Promise<Landed | LandFailure> {
  return kind === "skill"
    ? landSkill(container, userId, document)
    : landEquipment(container, userId, document, kind);
}

async function landSkill(
  container: ReturnType<typeof getContainer>,
  userId: UserId,
  document: string,
): Promise<Landed | LandFailure> {
  const parsed = parseSkillMd(document);
  if (isErr(parsed)) {
    return {
      response: invalidRequestResponse(
        `This doesn't look like a valid SKILL.md yet - ${parsed.error.message}`,
      ),
    };
  }

  const skillCap = await checkSkillCreateCap({ skills: container.skills, userId });
  if (isErr(skillCap)) return { response: domainErrorResponse(skillCap.error) };

  const saved = await container.skills.create({ userId, source: parsed.value });
  if (isErr(saved)) return { response: domainErrorResponse(saved.error) };

  const artifact = createHeroArtifact(saved.value.source);
  const lint = createLintReport(saved.value);
  return {
    kind: "skill",
    name: saved.value.source.frontmatter.name,
    payload: {
      skill: {
        id: saved.value.id,
        source: saved.value.source,
        latestRevision: saved.value.latestRevision,
        lintSummary: createLintSummary(saved.value.source),
      },
      rendered: renderedRenderer.render(artifact),
      source: sourceRenderer.render(artifact),
      lint: {
        insights: lintInsightsRenderer.render(lint),
        breakdown: lintBreakdownRenderer.render(lint),
      },
    },
  };
}

async function landEquipment(
  container: ReturnType<typeof getContainer>,
  userId: UserId,
  document: string,
  kind: Exclude<ImportPrimitiveKind, "skill">,
): Promise<Landed | LandFailure> {
  const checked = await checkEquipment(document, kind);
  if ("message" in checked) return { response: invalidRequestResponse(checked.message) };
  if (!checked.name.trim()) {
    return { response: invalidRequestResponse("This needs a name before it can be saved.") };
  }

  const saved = await container.equipment.save({
    userId,
    kind,
    name: checked.name,
    document,
  });
  if (isErr(saved)) return { response: domainErrorResponse(saved.error) };
  return {
    kind,
    name: checked.name,
    payload: { equipment: saved.value, quality: checked.quality },
  };
}

/**
 * Parse through the primitive's own source model and run its pure quality
 * check, so an imported document is held to exactly the bar a pasted one is.
 */
async function checkEquipment(
  document: string,
  kind: Exclude<ImportPrimitiveKind, "skill">,
): Promise<{ readonly name: string; readonly quality: unknown } | { readonly message: string }> {
  if (kind === "tool-contract") {
    const parsed = parseToolContract(document);
    if (!parsed.ok) return { message: parsed.error.message };
    const quality = await runCapability(toolContractCapability, "insights", parsed.value);
    if (!quality.ok) return { message: quality.error.message };
    return { name: parsed.value.name, quality: quality.value };
  }
  if (kind === "subagent-definition") {
    const parsed = parseSubagentDefinition(document);
    if (!parsed.ok) return { message: parsed.error.message };
    const quality = await runCapability(subagentDefinitionCapability, "insights", parsed.value);
    if (!quality.ok) return { message: quality.error.message };
    return { name: parsed.value.frontmatter.name, quality: quality.value };
  }
  const parsed = parseResponseSchema(document);
  if (!parsed.ok) return { message: parsed.error.message };
  const quality = await runCapability(responseSchemaCapability, "insights", parsed.value);
  if (!quality.ok) return { message: quality.error.message };
  return { name: responseSchemaName(parsed.value), quality: quality.value };
}
