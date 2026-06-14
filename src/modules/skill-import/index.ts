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
