import { getContainer } from "@/server/container";
import { runCapability } from "@/modules/skill-analysis";
import { createAgentConfigurationImportPreviewCapability } from "@/modules/agent-configuration-import";
import { REQUEST_RATE_LIMIT } from "@/modules/usage";
import {
  InvalidSourceSnapshot,
  SOURCE_SNAPSHOT_LIMITS,
  sourceSnapshotFromArchive,
  type LocalArchiveFormat,
} from "@/infra/agent-configuration-import";
import { isErr } from "@/shared";
import { domainErrorResponse } from "../../_shared/skill-request";
import { invalidRequestResponse } from "../../_shared/request-body";

export const runtime = "nodejs";

const FORMATS: readonly LocalArchiveFormat[] = ["zip", "tar", "tar.gz"];

/**
 * The import ladder's top rung (ARCHITECTURE §10): a whole agent configuration.
 *
 * The archive arrives as a raw binary body — base64 in JSON would inflate past
 * the request ceiling long before the archive limit. `?save=1` promotes the
 * preview to a saved configuration; without it nothing is persisted, which is
 * the point of the rung: you see everything found, including what was redacted
 * and what could not be read, before anything lands.
 *
 * Saving re-derives the snapshot from the bytes on this request. The snapshot
 * never round-trips through the client, so what is stored is always something
 * the server parsed under its own limits.
 */
export async function POST(request: Request): Promise<Response> {
  const container = getContainer();

  const identity = await container.auth.currentIdentity();
  if (!identity.ok) return domainErrorResponse(identity.error);
  if (identity.value === null) {
    return Response.json({ error: "Sign in to import an agent configuration." }, { status: 401 });
  }

  const rate = await container.requestRateLimiter.consume(
    identity.value.userId,
    "import",
    REQUEST_RATE_LIMIT,
  );
  if (isErr(rate)) return domainErrorResponse(rate.error);
  if (!rate.value.allowed) {
    return domainErrorResponse({ tag: "cap_reached", message: rate.value.reason });
  }

  const url = new URL(request.url);
  const format = url.searchParams.get("format") ?? "zip";
  if (!isFormat(format)) {
    return invalidRequestResponse("Import a .zip, .tar, or .tar.gz archive.");
  }

  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > SOURCE_SNAPSHOT_LIMITS.maxArchiveBytes) {
    return invalidRequestResponse("That archive is larger than the import limit.");
  }
  const archive = new Uint8Array(await request.arrayBuffer());
  if (archive.byteLength === 0) return invalidRequestResponse("Send an archive to import.");
  if (archive.byteLength > SOURCE_SNAPSHOT_LIMITS.maxArchiveBytes) {
    return invalidRequestResponse("That archive is larger than the import limit.");
  }

  let snapshot;
  try {
    snapshot = sourceSnapshotFromArchive(archive, format);
  } catch (cause) {
    if (cause instanceof InvalidSourceSnapshot) return invalidRequestResponse(cause.message);
    throw cause;
  }

  const capability = createAgentConfigurationImportPreviewCapability(
    container.agentConfigurationImportAdapters,
  );
  const preview = await runCapability(capability, "preview", snapshot);
  if (!preview.ok) return domainErrorResponse(preview.error);

  if (url.searchParams.get("save") !== "1") {
    return Response.json({ preview: preview.value, saved: null });
  }

  const name = (url.searchParams.get("name") ?? "").trim();
  if (!name) {
    return invalidRequestResponse("Give the configuration a name before saving it.");
  }

  const saved = await container.agentConfigurations.create({
    userId: identity.value.userId,
    name,
    snapshot: preview.value.snapshot,
  });
  if (isErr(saved)) return domainErrorResponse(saved.error);
  return Response.json({ preview: preview.value, saved: saved.value });
}

function isFormat(value: string): value is LocalArchiveFormat {
  return (FORMATS as readonly string[]).includes(value);
}
