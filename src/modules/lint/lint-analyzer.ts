import { serializeSkillMd, type Skill, type SkillSource } from "@/modules/skill";
import type { AnalysisContext, AnalysisReferenceFile, Analyzer } from "@/modules/skill-analysis";
import { ok, SKILL_BODY_MAX, SKILL_DESCRIPTION_MAX, SKILL_NAME_MAX } from "@/shared";
import type { LintFinding, LintReport, LintSeverity, LintSummary } from "./lint.types";

const SKILL_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const DESCRIPTION_MIN = 12;
const DESCRIPTION_SOFT_MAX = 300;
const BODY_TOKEN_WARN = 6_000;
const DESCRIPTION_FILLER_OPENINGS = [
  "a skill for",
  "helps with",
  "assists with",
  "useful for",
  "designed to",
] as const;
const DESCRIPTION_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "for",
  "in",
  "of",
  "the",
  "to",
  "use",
  "with",
  "skill",
  "helps",
  "assist",
  "assists",
]);
const DESCRIPTION_TRIGGER_WORDS = new Set([
  "add",
  "analyze",
  "answer",
  "audit",
  "build",
  "check",
  "classify",
  "convert",
  "create",
  "debug",
  "diagnose",
  "draft",
  "edit",
  "extract",
  "fix",
  "generate",
  "import",
  "investigate",
  "plan",
  "review",
  "run",
  "sort",
  "summarize",
  "test",
  "triage",
  "update",
  "validate",
]);
const NEGATIVE_SCOPE_PATTERN =
  /\b(?:when not to use|do not use|don't use|not suitable|avoid using|out of scope|skip this skill)\b/i;
const EXAMPLE_PATTERN = /\bexamples?\b|```/i;
const VAGUE_STEP_PATTERN =
  /^\s*(?:[-*]|\d+\.)\s+(?:understand|ensure|consider|think about|help(?:\s+with)?|improve|handle|manage|support)\b/im;
const LONG_PARAGRAPH_LENGTH = 700;
const POLICY_RULES = [
  {
    rule: "policy.fetch-and-follow",
    severity: "error",
    message:
      "The skill tells an agent to fetch remote content and follow it as instructions. Published skills must keep instructions inspectable in the skill folder.",
    patterns: [
      /\b(?:fetch|download|load|retrieve|curl|wget)\b[\s\S]{0,160}\bhttps?:\/\/\S+[\s\S]{0,160}\b(?:follow|obey|execute|run|use|treat|apply)\b[\s\S]{0,80}\b(?:instructions?|prompt|commands?|steps?|directions?)\b/i,
      /\b(?:follow|obey|execute|run|use|treat|apply)\b[\s\S]{0,80}\b(?:instructions?|prompt|commands?|steps?|directions?)\b[\s\S]{0,160}\b(?:from|at)\b[\s\S]{0,80}\bhttps?:\/\/\S+/i,
    ],
  },
  {
    rule: "policy.shell-exec",
    severity: "warn",
    message:
      "The skill asks the host agent to run shell or terminal commands. Keep published skills instruction-only unless the user explicitly supplies the command context.",
    patterns: [
      /\b(?:run|execute|launch|open|start)\b[\s\S]{0,80}\b(?:shell|terminal|bash|zsh|sh|powershell|cmd\.exe|command line)\b/i,
      /\b(?:run|execute)\b[\s\S]{0,80}`(?:sudo\s+|bash\b|sh\b|zsh\b|powershell\b|cmd\b|curl\b|wget\b|npm\b|python\b|node\b)[^`]*`/i,
      /`(?:curl|wget)\b[^`|]*(?:\|\s*(?:bash|sh|zsh))[^`]*`/i,
    ],
  },
  {
    rule: "policy.credential-path",
    severity: "warn",
    message:
      "The skill references credential or secret file locations. Avoid teaching agents to inspect keys, tokens, or local secret stores.",
    patterns: [
      /(?:^|[\s`"'])~?\/?(?:\.ssh\/(?:id_rsa|id_ed25519|config)|\.aws\/credentials|\.config\/gh\/hosts\.yml|\.npmrc|\.netrc|\.env(?:\.[\w-]+)?)(?=$|[\s`"',.:;)\]])/im,
      /\b(?:api[_-]?key|access[_-]?token|secret|credential|private key|bearer token)\b[\s\S]{0,100}\b(?:file|path|location|store|env file|\.env)\b/i,
    ],
  },
  {
    rule: "policy.obfuscation",
    severity: "warn",
    message:
      "The skill appears to rely on encoded or obfuscated payloads. Keep skill instructions readable so reviewers and users can inspect them.",
    patterns: [
      /\b(?:base64|rot13|hex encoded|hex-encoded|encoded payload|obfuscated payload|atob|eval)\b[\s\S]{0,120}\b(?:decode|payload|instructions?|commands?|script)\b/i,
      /\b(?:decode|deobfuscate)\b[\s\S]{0,80}\b(?:and|then)\b[\s\S]{0,80}\b(?:follow|obey|execute|run|apply)\b/i,
    ],
  },
] as const satisfies readonly {
  readonly rule: string;
  readonly severity: LintSeverity;
  readonly message: string;
  readonly patterns: readonly RegExp[];
}[];

export const LINT_RULESET_VERSION = {
  skillNamePattern: SKILL_NAME_PATTERN.source,
  descriptionMin: DESCRIPTION_MIN,
  descriptionSoftMax: DESCRIPTION_SOFT_MAX,
  bodyTokenWarn: BODY_TOKEN_WARN,
  descriptionFillerOpenings: DESCRIPTION_FILLER_OPENINGS,
  descriptionTriggerWords: [...DESCRIPTION_TRIGGER_WORDS].sort(),
  policyRules: POLICY_RULES.map((rule) => ({
    rule: rule.rule,
    severity: rule.severity,
    message: rule.message,
    patterns: rule.patterns.map((pattern) => pattern.source),
  })),
} as const;

export const lintAnalyzer: Analyzer<Skill, LintReport> = {
  kind: "lint",
  async analyze(skill: Skill, context?: AnalysisContext) {
    return ok(createLintReport(skill, context?.referenceFiles ?? []));
  },
};

export function createLintReport(
  skill: Skill,
  referenceFiles: readonly (string | AnalysisReferenceFile)[] = [],
): LintReport {
  return createLintReportForSource(skill.source, referenceFiles);
}

export function createLintSummary(source: SkillSource): LintSummary {
  return createLintReportForSource(source).summary;
}

export function createLintReportForSource(
  source: SkillSource,
  referenceFiles: readonly (string | AnalysisReferenceFile)[] = [],
): LintReport {
  const raw = serializeSkillMd(source);
  const findings: LintFinding[] = [];
  const name = source.frontmatter.name;
  const description = source.frontmatter.description;
  const body = source.body;
  const folderDocuments = folderDocumentsFor(raw, referenceFiles);
  const knownReferenceFiles = new Set(folderDocuments.map((document) => document.path));

  addFinding(findings, raw, "name:", validateName(name));
  addFinding(findings, raw, "description:", validateDescription(description));
  findings.push(...validateDescriptionQuality(raw, name, description, body));

  for (const key of Object.keys(source.frontmatter.extra).sort()) {
    addFinding(findings, raw, `${key}:`, {
      rule: "frontmatter.unknown-key",
      severity: "info",
      message: `Extra frontmatter key \`${key}\` will be preserved, but agent.branch does not use it yet.`,
    });
  }

  addFinding(findings, raw, body.trimStart().slice(0, 40), validateBody(body));
  findings.push(...validateBodyQuality(raw, body));
  findings.push(...validateReferenceLinks(raw, body, knownReferenceFiles));
  findings.push(...validatePolicyRules(folderDocuments));

  const tokenEstimate = estimateTokens(body);
  if (tokenEstimate > BODY_TOKEN_WARN) {
    findings.push({
      rule: "body.token-footprint",
      severity: "warn",
      message: `The body is roughly ${tokenEstimate.toLocaleString("en-US")} tokens. Consider moving reference material into separate files so the core skill stays quick to load.`,
      sourceSpan: spanOf(raw, body.trimStart().slice(0, 40)),
    });
  }

  return { kind: "lint", summary: summarizeLintFindings(findings), findings };
}

function folderDocumentsFor(
  raw: string,
  referenceFiles: readonly (string | AnalysisReferenceFile)[],
): readonly FolderDocument[] {
  return [
    { path: "SKILL.md", content: raw, source: "skill" },
    ...referenceFiles.map((file) =>
      typeof file === "string"
        ? { path: normalizeReferencePath(file), content: "", source: "reference" as const }
        : {
            path: normalizeReferencePath(file.path),
            content: file.content,
            source: "reference" as const,
          },
    ),
  ];
}

type FolderDocument = {
  readonly path: string;
  readonly content: string;
  readonly source: "skill" | "reference";
};

function validatePolicyRules(documents: readonly FolderDocument[]): LintFinding[] {
  const findings: LintFinding[] = [];

  for (const policyRule of POLICY_RULES) {
    const match = firstPolicyMatch(documents, policyRule.patterns);
    if (match === null) continue;

    findings.push({
      rule: policyRule.rule,
      severity: policyRule.severity,
      message:
        match.document.path === "SKILL.md"
          ? policyRule.message
          : `${policyRule.message} Found in \`${match.document.path}\`.`,
      sourceSpan:
        match.document.source === "skill"
          ? { start: match.index, end: match.index + match.text.length }
          : undefined,
    });
  }

  return findings;
}

function firstPolicyMatch(
  documents: readonly FolderDocument[],
  patterns: readonly RegExp[],
): { readonly document: FolderDocument; readonly index: number; readonly text: string } | null {
  for (const document of documents) {
    if (document.content.trim().length === 0) continue;
    for (const pattern of patterns) {
      const match = document.content.match(pattern);
      if (match?.[0] === undefined || match.index === undefined) continue;
      return { document, index: match.index, text: match[0] };
    }
  }
  return null;
}

function validateReferenceLinks(
  raw: string,
  body: string,
  knownReferenceFiles: ReadonlySet<string>,
): LintFinding[] {
  const findings: LintFinding[] = [];
  const bodyStart = raw.indexOf(body);
  const linkPattern = /\[[^\]\n]+\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

  for (const match of body.matchAll(linkPattern)) {
    const href = match[1];
    if (href === undefined) continue;
    if (!isLocalReference(href)) continue;

    const normalized = normalizeReferencePath(href);
    if (knownReferenceFiles.has(normalized)) continue;

    const hrefOffset = match[0].indexOf(href);
    const start = bodyStart === -1 ? -1 : bodyStart + (match.index ?? 0) + hrefOffset;
    findings.push({
      rule: "body.reference-file.missing",
      severity: "info",
      message: `Local reference link \`${href}\` does not match a known skill file.`,
      sourceSpan: start === -1 ? undefined : { start, end: start + href.length },
    });
  }

  return findings;
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

function validateDescriptionQuality(
  raw: string,
  name: string,
  description: string,
  body: string,
): LintFinding[] {
  const findings: LintFinding[] = [];
  const trimmed = description.trim();
  if (trimmed.length === 0) return findings;

  const normalized = trimmed.toLowerCase();
  const descriptionTokens = contentTokens(trimmed);
  const nameTokens = contentTokens(name.replaceAll("-", " "));

  if (DESCRIPTION_FILLER_OPENINGS.some((opening) => normalized.startsWith(opening))) {
    findings.push({
      rule: "frontmatter.description.weak-opening",
      severity: "warn",
      message:
        "The description opens with filler. Try: start with the concrete task or trigger phrase an agent would recognize.",
      sourceSpan: spanOf(raw, trimmed),
    });
  }

  if (nameTokens.length > 0 && descriptionTokens.length > 0) {
    const nameTokenSet = new Set(nameTokens);
    const nonNameTokens = descriptionTokens.filter((token) => !nameTokenSet.has(token));
    if (nonNameTokens.length <= 1) {
      findings.push({
        rule: "frontmatter.description.restates-name",
        severity: "warn",
        message:
          "The description mostly restates the skill name. Try: add the user task, artifact, or decision this skill handles.",
        sourceSpan: spanOf(raw, trimmed),
      });
    }
  }

  if (!descriptionTokens.some((token) => DESCRIPTION_TRIGGER_WORDS.has(token))) {
    findings.push({
      rule: "frontmatter.description.trigger-vocabulary",
      severity: "warn",
      message:
        "The description lacks clear trigger vocabulary. Try: include an action such as review, generate, debug, import, or validate.",
      sourceSpan: spanOf(raw, trimmed),
    });
  }

  const bodyTokens = contentTokens(body);
  if (descriptionTokens.length >= 4 && bodyTokens.length >= 12) {
    const bodyTokenSet = new Set(bodyTokens);
    const overlap = descriptionTokens.filter((token) => bodyTokenSet.has(token));
    if (overlap.length === 0) {
      findings.push({
        rule: "frontmatter.description.body-overlap",
        severity: "warn",
        message:
          "The description and body do not share concrete vocabulary. Try: make the trigger text name the workflow described in the instructions.",
        sourceSpan: spanOf(raw, trimmed),
      });
    }
  }

  return findings;
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

function validateBodyQuality(raw: string, body: string): LintFinding[] {
  const trimmed = body.trim();
  if (trimmed.length === 0) return [];

  const findings: LintFinding[] = [];

  if (!NEGATIVE_SCOPE_PATTERN.test(body)) {
    findings.push({
      rule: "body.negative-scope.missing",
      severity: "warn",
      message:
        "The body does not say when not to use the skill. Try: add one short out-of-scope note to reduce false triggers.",
      sourceSpan: spanOf(raw, trimmed.slice(0, 40)),
    });
  }

  if (!EXAMPLE_PATTERN.test(body)) {
    findings.push({
      rule: "body.examples.missing",
      severity: "info",
      message:
        "The body has no examples. Try: include a compact example input, output, or decision so agents can copy the pattern.",
      sourceSpan: spanOf(raw, trimmed.slice(0, 40)),
    });
  }

  const vagueStep = body.match(VAGUE_STEP_PATTERN);
  if (vagueStep?.[0]) {
    findings.push({
      rule: "body.steps.vague-action",
      severity: "info",
      message:
        "One step is phrased as a broad goal instead of an action. Try: start steps with observable verbs like read, compare, run, draft, or update.",
      sourceSpan: spanOf(raw, vagueStep[0].trim()),
    });
  }

  const longParagraph = body
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .find((paragraph) => paragraph.length > LONG_PARAGRAPH_LENGTH && !paragraph.includes("\n- "));
  if (longParagraph !== undefined) {
    findings.push({
      rule: "body.structure.long-paragraph",
      severity: "info",
      message:
        "A paragraph is long and hard to scan. Try: split it into headed steps, bullets, or a reference file.",
      sourceSpan: spanOf(raw, longParagraph.slice(0, 40)),
    });
  }

  return findings;
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

/**
 * Fold findings into the score/grade/counts summary. Shared by every
 * LintReport-shaped quality artifact (skill lint here; response-schema and
 * tool-contract lint reuse it), so all quality surfaces grade the same way.
 */
export function summarizeLintFindings(findings: readonly LintFinding[]): LintSummary {
  const counts: Record<LintSeverity, number> = { error: 0, warn: 0, info: 0 };
  for (const finding of findings) counts[finding.severity] += 1;

  const score = Math.max(0, 100 - counts.error * 35 - counts.warn * 12 - counts.info * 3);
  const grade: LintSummary["grade"] =
    score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : "D";
  const rules = [...new Set(findings.map((finding) => finding.rule))].sort();
  return { score, grade, counts, rules };
}

function estimateTokens(text: string): number {
  return Math.ceil(text.trim().split(/\s+/).filter(Boolean).length * 1.35);
}

function contentTokens(text: string): string[] {
  return text
    .toLowerCase()
    .match(/[a-z][a-z0-9-]{2,}/g)
    ?.map((token) => token.replace(/ing$|ed$|s$/u, ""))
    .filter((token) => !DESCRIPTION_STOP_WORDS.has(token)) ?? [];
}

function isLocalReference(href: string): boolean {
  return !/^(?:[a-z][a-z0-9+.-]*:|#|\/)/i.test(href);
}

function normalizeReferencePath(path: string): string {
  return (path.split("#", 1)[0] ?? "").replace(/^\.\//, "");
}
