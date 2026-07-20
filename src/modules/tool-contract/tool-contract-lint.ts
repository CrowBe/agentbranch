import { summarizeLintFindings, type LintFinding } from "@/modules/lint";
import { schemaShapeFindings, validateAgainstSchema } from "@/modules/response-schema";
import type { Analyzer } from "@/modules/skill-analysis";
import { ok } from "@/shared";
import type {
  ToolContractIo,
  ToolContractLintReport,
  ToolContractSource,
} from "./tool-contract.types";

/** Portable tool names — same shape the mock-tool registry and gateway use. */
export const TOOL_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;
const TOOL_NAME_MAX = 60;
const DESCRIPTION_MIN = 12;

export const TOOL_CONTRACT_LINT_RULESET_VERSION = {
  toolNamePattern: TOOL_NAME_PATTERN.source,
  toolNameMax: TOOL_NAME_MAX,
  descriptionMin: DESCRIPTION_MIN,
} as const;

/**
 * The tool-contract quality analyzer — pure, offline, zero tokens: I/O typing
 * completeness, description/example quality, declared failure modes, and
 * safety-note presence. Inline schemas run the same shape rules as the
 * response-schema primitive (`schemaShapeFindings`), so schema quality reads
 * one way across primitives.
 */
export const toolContractLintAnalyzer: Analyzer<ToolContractSource, ToolContractLintReport> = {
  kind: "tool-contract-lint",
  async analyze(source: ToolContractSource) {
    return ok(createToolContractLintReport(source));
  },
};

export function createToolContractLintReport(source: ToolContractSource): ToolContractLintReport {
  const findings: LintFinding[] = [];

  if (source.name.length > TOOL_NAME_MAX) {
    findings.push({
      rule: "contract.name.length",
      severity: "error",
      message: `Tool names need to stay under ${TOOL_NAME_MAX} characters.`,
    });
  } else if (!TOOL_NAME_PATTERN.test(source.name)) {
    findings.push({
      rule: "contract.name.format",
      severity: "warn",
      message:
        "Use a portable tool name: letters, numbers, underscores, and hyphens, starting with a letter.",
    });
  }

  if (source.description.trim().length < DESCRIPTION_MIN) {
    findings.push({
      rule: "contract.description.too-short",
      severity: "warn",
      message:
        "The tool description is very short. Say what the tool does and when an agent should call it.",
    });
  }

  findings.push(...ioFindings(source.input, "input"));
  findings.push(...ioFindings(source.output, "output"));

  if (source.examples.length === 0) {
    findings.push({
      rule: "contract.examples.missing",
      severity: "warn",
      message:
        "The contract has no examples. Add one worked call so agents and reviewers can copy the pattern.",
    });
  } else if (source.input?.kind === "inline") {
    const inputSchema = source.input.schema;
    source.examples.forEach((example, index) => {
      const issues = validateAgainstSchema(example.input, inputSchema, `examples[${index}].input`);
      if (issues.length > 0) {
        findings.push({
          rule: "contract.example.input-mismatch",
          severity: "error",
          message: `Example ${index + 1} does not match the declared input schema: ${issues[0]}`,
        });
      }
    });
  }

  if (source.failureModes.length === 0) {
    findings.push({
      rule: "contract.failure-modes.missing",
      severity: "warn",
      message:
        "No failure modes declared. List how the tool can fail so skills can plan for it.",
    });
  }

  if (source.safetyNotes.length === 0) {
    findings.push({
      rule: "contract.safety-notes.missing",
      severity: "info",
      message:
        "No safety notes declared. Note anything the tool touches that deserves care (data, money, messages).",
    });
  }

  return { kind: "tool-contract-lint", source, summary: summarizeLintFindings(findings), findings };
}

function ioFindings(io: ToolContractIo | undefined, side: "input" | "output"): LintFinding[] {
  if (io === undefined) {
    return [
      {
        rule: `contract.${side}.missing`,
        severity: "warn",
        message: `The contract declares no \`${side}\` shape, so ${side === "input" ? "call arguments" : "results"} cannot be validated.`,
      },
    ];
  }
  if (io.kind === "schema-ref") {
    // The reference resolves at composition time (a test-run bundle supplies
    // the response schemas); standalone lint only checks the shape.
    return [];
  }
  return schemaShapeFindings(io.schema, side);
}
