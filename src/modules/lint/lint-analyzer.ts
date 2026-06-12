import { serializeSkillMd, type Skill, skillDescription, skillName } from "@/modules/skill";
import type { Analyzer } from "@/modules/skill-analysis";
import { ok, SKILL_BODY_MAX, SKILL_DESCRIPTION_MAX, SKILL_NAME_MAX } from "@/shared";
import type { LintFinding, LintReport, LintSeverity, LintSummary } from "./lint.types";

const SKILL_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const DESCRIPTION_MIN = 12;
const DESCRIPTION_SOFT_MAX = 300;
const BODY_TOKEN_WARN = 6_000;

export const lintAnalyzer: Analyzer<LintReport> = {
  kind: "lint",
  async analyze(skill: Skill) {
    return ok(createLintReport(skill));
  },
};

export function createLintReport(skill: Skill): LintReport {
  const raw = serializeSkillMd(skill.source);
  const findings: LintFinding[] = [];
  const name = skillName(skill);
  const description = skillDescription(skill);
  const body = skill.source.body;

  addFinding(findings, raw, "name:", validateName(name));
  addFinding(findings, raw, "description:", validateDescription(description));

  for (const key of Object.keys(skill.source.frontmatter.extra).sort()) {
    addFinding(findings, raw, `${key}:`, {
      rule: "frontmatter.unknown-key",
      severity: "info",
      message: `Extra frontmatter key \`${key}\` will be preserved, but SkillSmith does not use it yet.`,
    });
  }

  addFinding(findings, raw, body.trimStart().slice(0, 40), validateBody(body));

  const tokenEstimate = estimateTokens(body);
  if (tokenEstimate > BODY_TOKEN_WARN) {
    findings.push({
      rule: "body.token-footprint",
      severity: "warn",
      message: `The body is roughly ${tokenEstimate.toLocaleString("en-US")} tokens. Consider moving reference material into separate files so the core skill stays quick to load.`,
      sourceSpan: spanOf(raw, body.trimStart().slice(0, 40)),
    });
  }

  return { kind: "lint", summary: summarize(findings), findings };
}

function validateName(name: string): Omit<LintFinding, "sourceSpan"> | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return {
      rule: "frontmatter.name.required",
      severity: "error",
      message: "Your skill needs a frontmatter `name`.",
    };
  }
  if (trimmed.length > SKILL_NAME_MAX) {
    return {
      rule: "frontmatter.name.length",
      severity: "error",
      message: `Skill names need to stay under ${SKILL_NAME_MAX} characters.`,
    };
  }
  if (!SKILL_NAME_PATTERN.test(trimmed)) {
    return {
      rule: "frontmatter.name.format",
      severity: "warn",
      message: "Use a portable skill name with lowercase letters, numbers, and hyphens.",
    };
  }
  return null;
}

function validateDescription(description: string): Omit<LintFinding, "sourceSpan"> | null {
  const trimmed = description.trim();
  if (trimmed.length === 0) {
    return {
      rule: "frontmatter.description.required",
      severity: "error",
      message: "Your skill needs a frontmatter `description` so agents know when to use it.",
    };
  }
  if (trimmed.length > SKILL_DESCRIPTION_MAX) {
    return {
      rule: "frontmatter.description.length",
      severity: "error",
      message: `Descriptions need to stay under ${SKILL_DESCRIPTION_MAX} characters.`,
    };
  }
  if (trimmed.length < DESCRIPTION_MIN) {
    return {
      rule: "frontmatter.description.too-short",
      severity: "warn",
      message: "The description is very short. Add the task, trigger, or target outcome.",
    };
  }
  if (trimmed.length > DESCRIPTION_SOFT_MAX) {
    return {
      rule: "frontmatter.description.too-long",
      severity: "warn",
      message: "The description is long for trigger selection. Keep it focused on when to use the skill.",
    };
  }
  return null;
}

function validateBody(body: string): Omit<LintFinding, "sourceSpan"> | null {
  const trimmed = body.trim();
  if (trimmed.length === 0) {
    return {
      rule: "body.required",
      severity: "error",
      message: "Add instructions to the body so the skill has something to do after it triggers.",
    };
  }
  if (body.length > SKILL_BODY_MAX) {
    return {
      rule: "body.length",
      severity: "error",
      message: `The body needs to stay under ${SKILL_BODY_MAX.toLocaleString("en-US")} characters.`,
    };
  }
  if (!/^#{1,6}\s+\S/m.test(body)) {
    return {
      rule: "body.structure.headings",
      severity: "info",
      message: "Headings make the workflow easier to scan and easier to inspect later.",
    };
  }
  return null;
}

function addFinding(
  findings: LintFinding[],
  raw: string,
  needle: string,
  finding: Omit<LintFinding, "sourceSpan"> | null,
): void {
  if (finding === null) return;
  findings.push({ ...finding, sourceSpan: spanOf(raw, needle) });
}

function spanOf(raw: string, needle: string): { start: number; end: number } | undefined {
  if (needle.length === 0) return undefined;
  const start = raw.indexOf(needle);
  return start === -1 ? undefined : { start, end: start + needle.length };
}

function summarize(findings: readonly LintFinding[]): LintSummary {
  const counts: Record<LintSeverity, number> = { error: 0, warn: 0, info: 0 };
  for (const finding of findings) counts[finding.severity] += 1;

  const score = Math.max(0, 100 - counts.error * 35 - counts.warn * 12 - counts.info * 3);
  const grade: LintSummary["grade"] =
    score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : "D";
  return { score, grade, counts };
}

function estimateTokens(text: string): number {
  return Math.ceil(text.trim().split(/\s+/).filter(Boolean).length * 1.35);
}
