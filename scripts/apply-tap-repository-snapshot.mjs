#!/usr/bin/env node

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const snapshotSource = args.snapshot ?? process.env.TAP_REPOSITORY_SNAPSHOT;
  const repoDir = path.resolve(args.repo ?? process.env.TAP_REPOSITORY_DIR ?? process.cwd());

  if (!snapshotSource) {
    fail("Missing snapshot source. Pass --snapshot <url-or-file> or set TAP_REPOSITORY_SNAPSHOT.");
  }

  const snapshot = JSON.parse(await readSnapshot(snapshotSource));
  await applyTapRepositoryFiles(snapshot.files, repoDir, { dryRun: args.dryRun === true });
}

export async function applyTapRepositoryFiles(files, repoDir, options = {}) {
  const validated = validateSnapshot({ files });
  const resolvedRepoDir = path.resolve(repoDir);
  if (options.dryRun) {
    console.log(`Would apply ${validated.length} tap repository file(s) to ${resolvedRepoDir}:`);
    for (const file of validated) console.log(file.path);
    return;
  }

  await rm(path.join(resolvedRepoDir, "skills"), { recursive: true, force: true });
  await rm(path.join(resolvedRepoDir, ".claude-plugin", "marketplace.json"), { force: true });
  for (const file of validated) {
    const target = path.join(resolvedRepoDir, file.path);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, file.content);
  }
  console.log(`Applied ${validated.length} tap repository file(s) to ${resolvedRepoDir}.`);
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--snapshot") parsed.snapshot = argv[++i];
    else if (arg === "--repo") parsed.repo = argv[++i];
    else if (arg === "--dry-run") parsed.dryRun = true;
    else fail(`Unknown argument: ${arg}`);
  }
  return parsed;
}

async function readSnapshot(source) {
  if (/^https?:\/\//u.test(source)) {
    const response = await fetch(source);
    if (!response.ok) {
      fail(`Failed to fetch ${source}: ${response.status} ${response.statusText}`);
    }
    return response.text();
  }
  return readFile(path.resolve(source), "utf8");
}

function validateSnapshot(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.files)) {
    fail("Tap snapshot must be a JSON object with a files array.");
  }

  const seen = new Set();
  return snapshot.files.map((file) => {
    if (!file || typeof file.path !== "string" || typeof file.content !== "string") {
      fail("Each tap snapshot file must have string path and content fields.");
    }
    if (path.isAbsolute(file.path) || file.path.includes("\\") || file.path.split("/").includes("..")) {
      fail(`Unsafe tap snapshot path: ${file.path}`);
    }
    if (file.path !== ".claude-plugin/marketplace.json" && !file.path.startsWith("skills/")) {
      fail(`Unexpected tap snapshot path: ${file.path}`);
    }
    if (seen.has(file.path)) {
      fail(`Duplicate tap snapshot path: ${file.path}`);
    }
    seen.add(file.path);
    return file;
  });
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
