import type { LintFinding, LintSummary } from "@/modules/lint";
import type { Artifact } from "@/modules/skill-analysis";

/**
 * The raw, source-of-truth representation of a response schema: the full JSON
 * Schema document, every key preserved verbatim so `parseResponseSchema` /
 * `serializeResponseSchema` round-trip losslessly. Mirrors `SkillSource` for
 * the `skill` aggregate — no identity or persistence concerns; the equipment
 * primitive is the document itself (ARCHITECTURE §9.2).
 */
export type ResponseSchemaSource = {
  readonly document: Readonly<Record<string, unknown>>;
};

/** Failure modes when reading or editing a response-schema document. */
export type ResponseSchemaError =
  | { readonly tag: "invalid_json"; readonly message: string }
  | { readonly tag: "not_an_object"; readonly message: string }
  | { readonly tag: "edit_no_match"; readonly message: string };

/**
 * The response-schema quality artifact — LintReport-shaped (same summary and
 * finding vocabulary as skill lint, so every quality surface grades alike) but
 * its own `ArtifactKind`, because it is a distinct capability on the seam.
 */
export type ResponseSchemaLintReport = Artifact<"response-schema-lint"> & {
  readonly source?: ResponseSchemaSource;
  readonly summary: LintSummary;
  readonly findings: readonly LintFinding[];
};
