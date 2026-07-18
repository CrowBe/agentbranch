#!/usr/bin/env -S npx tsx
// Advisory lint-policy run over a public tap repo checkout (ARCHITECTURE §9.1).
// The tap repo's CI calls this from an agent.branch checkout
// (`npx tsx scripts/lint-tap-skills.ts <tap-root>`), so the policy rules keep
// one home in src/modules/lint while running as open-source CI in the tap.
// Findings surface as GitHub annotations feeding the badge/flag presentation;
// the exit code is 0 whatever they say — verdicts annotate, never gate.

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { createLintReportForSource, type LintFinding, type LintSeverity } from "../src/modules/lint";
import { parseSkillMd } from "../src/modules/skill";
import type { AnalysisReferenceFile } from "../src/modules/skill-analysis";

const tapRoot = path.resolve(process.argv[2] ?? process.cwd());
const manifestPath = path.join(tapRoot, ".claude-plugin", "marketplace.json");

const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
  skills?: readonly { slug?: string }[];
};
if (!Array.isArray(manifest.skills)) {
  console.error(`No skills array in ${manifestPath}.`);
  process.exit(1);
}

let policyFindings = 0;
for (const entry of manifest.skills) {
  if (typeof entry.slug !== "string" || entry.slug.length === 0) continue;
  policyFindings += await lintSkillFolder(entry.slug);
}

console.log(
  `Advisory lint policy: ${manifest.skills.length} published skill(s), ` +
    `${policyFindings} policy finding(s). Findings never block a publish.`,
);

async function lintSkillFolder(slug: string): Promise<number> {
  const folder = path.join(tapRoot, "skills", slug);
  const skillPath = `skills/${slug}/SKILL.md`;

  let raw: string;
  try {
    raw = await readFile(path.join(folder, "SKILL.md"), "utf8");
  } catch {
    annotate("error", skillPath, `${slug}: manifest entry has no SKILL.md in the tap.`);
    return 1;
  }

  const source = parseSkillMd(raw);
  if (!source.ok) {
    annotate("error", skillPath, `${slug}: SKILL.md did not parse — ${source.error.message}`);
    return 1;
  }

  // The whole folder is in scope (reference-file smuggling is a named threat
  // class): every sibling file rides along as a reference document.
  const referenceFiles: AnalysisReferenceFile[] = [];
  for (const name of await listFilesRecursive(folder)) {
    if (name === "SKILL.md") continue;
    referenceFiles.push({
      path: name,
      content: await readFile(path.join(folder, name), "utf8"),
    });
  }

  const report = createLintReportForSource(source.value, referenceFiles);
  const policy = report.findings.filter((finding) => finding.rule.startsWith("policy."));
  for (const finding of policy) {
    annotate(finding.severity, skillPath, `${slug} [${finding.rule}]: ${message(finding)}`);
  }
  return policy.length;
}

async function listFilesRecursive(folder: string, prefix = ""): Promise<readonly string[]> {
  const entries = await readdir(folder, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursive(path.join(folder, entry.name), relative)));
    } else if (entry.isFile()) {
      files.push(relative);
    }
  }
  return files;
}

function message(finding: LintFinding): string {
  return finding.message.replaceAll("\n", " ");
}

function annotate(severity: LintSeverity | "error", file: string, text: string): void {
  const command = severity === "error" ? "error" : severity === "warn" ? "warning" : "notice";
  // GitHub annotation escaping for the message payload.
  const escaped = text.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
  console.log(`::${command} file=${file}::${escaped}`);
}
