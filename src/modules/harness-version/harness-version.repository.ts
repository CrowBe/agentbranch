import type { DomainError, Result } from "@/shared";
import type { HarnessManifest, HarnessVersion } from "./harness-version.types";

/** Persistence port for append-only harness manifest identity. */
export interface HarnessVersionRepository {
  current(manifest: HarnessManifest): Promise<Result<HarnessVersion, DomainError>>;
}
