/**
 * Tagged domain errors. Each module narrows these into its own union; the
 * `tag` is the discriminant a caller switches on.
 */
export type DomainError<Tag extends string = string> = {
  readonly tag: Tag;
  readonly message: string;
  readonly cause?: unknown;
};

export function domainError<Tag extends string>(
  tag: Tag,
  message: string,
  cause?: unknown,
): DomainError<Tag> {
  return { tag, message, cause };
}

/** Raised when an adapter is asked to act but the backing service is unconfigured. */
export type NotConfiguredError = DomainError<"not_configured">;

export function notConfigured(service: string): NotConfiguredError {
  return domainError(
    "not_configured",
    `${service} is not configured. Add the relevant secret to .env.local.`,
  );
}
