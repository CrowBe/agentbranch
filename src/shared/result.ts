/**
 * Result<T, E> — explicit success/failure at module boundaries.
 *
 * Domain modules return Results instead of throwing, so a caller in another
 * module (or the presentation layer) handles both paths with the type system,
 * not try/catch. Throwing is reserved for genuinely-unexpected programmer error.
 */
export type Ok<T> = { readonly ok: true; readonly value: T };
export type Err<E> = { readonly ok: false; readonly error: E };
export type Result<T, E> = Ok<T> | Err<E>;

export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

export function err<E>(error: E): Err<E> {
  return { ok: false, error };
}

export function isOk<T, E>(result: Result<T, E>): result is Ok<T> {
  return result.ok;
}

export function isErr<T, E>(result: Result<T, E>): result is Err<E> {
  return !result.ok;
}

/** Map the success value, leaving an error untouched. */
export function mapResult<T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => U,
): Result<U, E> {
  return result.ok ? ok(fn(result.value)) : result;
}

/** Unwrap or throw — use only at trusted edges (tests, top-level handlers). */
export function unwrap<T, E>(result: Result<T, E>): T {
  if (result.ok) return result.value;
  throw new Error(`Unwrapped an Err: ${JSON.stringify(result.error)}`);
}
