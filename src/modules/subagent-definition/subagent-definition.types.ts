import type { LintFinding, LintSummary } from "@/modules/lint";
import type { Artifact } from "@/modules/skill-analysis";

export type SubagentDefinitionSource = {
  readonly frontmatter: {
    readonly name: string;
    readonly description: string;
    readonly tools?: readonly string[];
    readonly model?: string;
    readonly extra: Readonly<Record<string, unknown>>;
  };
  readonly body: string;
};

export type SubagentDefinitionError =
  | { readonly tag: "invalid_frontmatter"; readonly message: string }
  | { readonly tag: "missing_name"; readonly message: string }
  | { readonly tag: "missing_description"; readonly message: string };

export type SubagentDefinitionLintReport = Artifact<"subagent-definition-lint"> & {
  readonly summary: LintSummary;
  readonly findings: readonly LintFinding[];
};

export type SubagentDefinitionRendered = {
  readonly name: string;
  readonly description: string;
  readonly tools: readonly string[];
  readonly model?: string;
  readonly instructions: string;
};
