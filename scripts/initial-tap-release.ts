#!/usr/bin/env node

import path from "node:path";
import { baselineSeedRecords } from "../prisma/seed";
import { baselineSkillCorpus } from "@/modules/baseline-corpus";
import { renderTapRepositoryFiles, TAP_REPOSITORY, type TapRepositorySkill } from "@/modules/publication";
import { parseSkillMd } from "@/modules/skill";
import { createDisabledTapSyncTrigger, createGithubTapSyncTrigger } from "@/infra/github/tap-sync-trigger";
import { isErr, PublicationId, SkillId, SkillVersionId, UserId } from "@/shared";
import { applyTapRepositoryFiles } from "./apply-tap-repository-snapshot.mjs";

export function renderInitialTapSnapshot() {
  const fixtures = new Map(baselineSkillCorpus.map((fixture) => [fixture.id, fixture]));
  const skills: TapRepositorySkill[] = baselineSeedRecords().map((record) => {
    const fixture = fixtures.get(record.corpusId);
    if (!fixture) throw new Error(`Missing baseline fixture ${record.corpusId}.`);
    const source = parseSkillMd(fixture.source);
    if (isErr(source)) throw new Error(source.error.message);
    return {
      publication: {
        id: PublicationId(record.publicationId),
        publisherId: UserId("system:agentbranch"),
        skillId: SkillId(record.skillId),
        skillVersionId: SkillVersionId(record.versionId),
        slug: record.slug,
        tier: "reviewed",
        contentHash: record.contentHash,
        createdAt: new Date(0),
      },
      source: source.value,
    };
  });
  const rendered = renderTapRepositoryFiles(skills);
  if (isErr(rendered)) throw new Error(rendered.error.message);
  return { files: rendered.value };
}

export async function runInitialTapRelease(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>> = process.env,
) {
  const args = parseArgs(argv);
  const snapshot = renderInitialTapSnapshot();
  const repoDir = path.resolve(args.repo ?? env.TAP_REPOSITORY_DIR ?? process.cwd());
  if (!args.fire) {
    await applyTapRepositoryFiles(snapshot.files, repoDir, { dryRun: true });
    return "dry-run" as const;
  }

  await applyTapRepositoryFiles(snapshot.files, repoDir);
  const token = env.TAP_SYNC_TOKEN?.trim();
  const trigger = token
    ? createGithubTapSyncTrigger({ repository: env.TAP_REPOSITORY?.trim() || TAP_REPOSITORY, token })
    : createDisabledTapSyncTrigger();
  const outcome = await trigger.requestSync();
  console.log(`Tap publish dispatch: ${outcome}.`);
  return outcome;
}

function parseArgs(argv: readonly string[]): { repo?: string; fire: boolean } {
  const parsed: { repo?: string; fire: boolean } = { fire: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--fire") parsed.fire = true;
    else if (arg === "--repo") {
      const repo = argv[index + 1];
      if (!repo) throw new Error("Missing value for --repo.");
      parsed.repo = repo;
      index += 1;
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runInitialTapRelease(process.argv.slice(2)).catch((cause: unknown) => {
    console.error(cause);
    process.exitCode = 1;
  });
}
