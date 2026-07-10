import type { LintFinding, LintSummary } from "@/modules/lint";
import type { Artifact } from "@/modules/skill-analysis";

/**
 * One side of a tool's I/O: an inline JSON Schema, or a reference to a
 * response-schema artifact by its `title` — how the two primitives compose
 * (ARCHITECTURE §9.2). In the JSON source a reference is written
 * `{ "$ref": "<response-schema title>" }`.
 */
export type ToolContractIo =
  | { readonly kind: "inline"; readonly schema: Readonly<Record<string, unknown>> }
  | { readonly kind: "schema-ref"; readonly ref: string };

/** A worked call the author shows consumers (and lint checks against the I/O). */
export type ToolContractExample = {
  readonly input: unknown;
  readonly output?: unknown;
  readonly note?: string;
};

/**
 * The raw, source-of-truth representation of a tool contract: what a tool is
 * called, what it takes and returns, and how it fails — typed I/O plus
 * descriptions, examples, failure modes, and safety notes (ARCHITECTURE §9.2,
 * primitive 2). Unknown top-level keys are preserved in `extra` so the
 * round-trip is lossless, mirroring `SkillSource`.
 */
export type ToolContractSource = {
  readonly name: string;
  readonly description: string;
  readonly input?: ToolContractIo;
  readonly output?: ToolContractIo;
  readonly examples: readonly ToolContractExample[];
  readonly failureModes: readonly string[];
  readonly safetyNotes: readonly string[];
  readonly extra: Readonly<Record<string, unknown>>;
};

/** Failure modes when reading or editing a tool-contract document. */
export type ToolContractError =
  | { readonly tag: "invalid_json"; readonly message: string }
  | { readonly tag: "invalid_contract"; readonly message: string }
  | { readonly tag: "edit_no_match"; readonly message: string };

/**
 * The tool-contract quality artifact — LintReport-shaped, like every quality
 * artifact on the seam, with its own `ArtifactKind`.
 */
export type ToolContractLintReport = Artifact<"tool-contract-lint"> & {
  readonly summary: LintSummary;
  readonly findings: readonly LintFinding[];
};
