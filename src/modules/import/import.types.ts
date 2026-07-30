import type { EquipmentKind } from "@/modules/equipment";

/**
 * The three rungs of the import ladder (ARCHITECTURE §10). Each rung accepts a
 * strictly larger unit of work than the one below it, so a user meets the
 * product at the complexity they already have rather than at the complexity the
 * product is capable of.
 */
export type ImportTier = "primitive" | "related-primitives" | "agent-configuration";

/** The primitive kinds a tier-1 or tier-2 import can land. */
export type ImportPrimitiveKind = "skill" | EquipmentKind;

export type ImportTierDescriptor = {
  readonly tier: ImportTier;
  /** User-facing rung name. */
  readonly label: string;
  /** One plain-language line: what this rung takes. */
  readonly summary: string;
};

/**
 * The rungs in ascending order of complexity. This is the one home for the
 * ladder's shape and copy — the interaction panel renders it, the routes
 * validate against it, and the doc-drift guard checks it against ARCHITECTURE.
 */
export const IMPORT_TIERS: readonly ImportTierDescriptor[] = Object.freeze([
  {
    tier: "primitive",
    label: "One building block",
    summary: "A single skill, response schema, tool contract, or subagent definition.",
  },
  {
    tier: "related-primitives",
    label: "Building blocks that work together",
    summary: "Several documents that belong together — a skill plus the tools and output shapes it uses.",
  },
  {
    tier: "agent-configuration",
    label: "A whole agent configuration",
    summary: "An archive of an existing agent setup. You review everything found before anything is saved.",
  },
] as const);

/**
 * What a document was recognised as. `alternatives` names the other kinds the
 * same bytes parse as cleanly — markdown carrying only `name` + `description`
 * is a valid skill *and* a valid subagent definition, and guessing silently
 * would file a user's work under the wrong primitive. The caller resolves the
 * ambiguity; the classifier only reports it.
 */
export type ImportClassification =
  | {
      readonly ok: true;
      readonly kind: ImportPrimitiveKind;
      readonly name: string;
      readonly alternatives: readonly ImportPrimitiveKind[];
    }
  | { readonly ok: false; readonly message: string };

export type SkillImportFetchError =
  | { readonly kind: "invalid_url"; readonly message: string }
  | { readonly kind: "not_found"; readonly message: string }
  | { readonly kind: "too_large"; readonly message: string }
  | { readonly kind: "not_text"; readonly message: string }
  | { readonly kind: "fetch_failed"; readonly message: string };

export type SkillImportFetcher = {
  readonly fetchSkillMd: (url: string) => Promise<
    import("@/shared").Result<string, SkillImportFetchError>
  >;
};
