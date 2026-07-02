import type { PrismaClient } from "@prisma/client";
import type {
  HarnessManifest,
  HarnessVersion,
  HarnessVersionRepository,
} from "@/modules/harness-version";
import { hashHarnessManifest } from "@/modules/harness-version";
import { domainError, err, HarnessVersionId, ok } from "@/shared";

type HarnessVersionRow = {
  id: string;
  manifestHash: string;
  buildLoopSystemPromptHash: string;
  lintRulesetHash: string;
  promptBatteryGeneratorHash: string;
  testRunWorldGeneratorHash: string;
  distractorLibraryHash: string;
  gitSha: string | null;
  createdAt: Date;
};

function toHarnessVersion(row: HarnessVersionRow): HarnessVersion {
  return {
    id: HarnessVersionId(row.id),
    manifestHash: row.manifestHash,
    buildLoopSystemPrompt: row.buildLoopSystemPromptHash,
    lintRuleset: row.lintRulesetHash,
    promptBatteryGenerator: row.promptBatteryGeneratorHash,
    testRunWorldGenerator: row.testRunWorldGeneratorHash,
    distractorLibrary: row.distractorLibraryHash,
    gitSha: row.gitSha,
    createdAt: row.createdAt,
  };
}

/** Prisma HarnessVersionRepository (real). Mints append-only manifest identities. */
export function createPrismaHarnessVersionRepository(
  prisma: PrismaClient,
): HarnessVersionRepository {
  return {
    async current(manifest: HarnessManifest) {
      try {
        const manifestHash = hashHarnessManifest(manifest);
        const row = await prisma.harnessVersion.upsert({
          where: { manifestHash },
          update: {},
          create: {
            manifestHash,
            buildLoopSystemPromptHash: manifest.buildLoopSystemPrompt,
            lintRulesetHash: manifest.lintRuleset,
            promptBatteryGeneratorHash: manifest.promptBatteryGenerator,
            testRunWorldGeneratorHash: manifest.testRunWorldGenerator,
            distractorLibraryHash: manifest.distractorLibrary,
            gitSha: manifest.gitSha,
          },
        });
        return ok(toHarnessVersion(row as HarnessVersionRow));
      } catch (cause) {
        return err(
          domainError("persistence_failed", "A harness manifest version could not be minted.", cause),
        );
      }
    },
  };
}
