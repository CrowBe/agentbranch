/**
 * Branded identifiers. A `SkillId` is structurally a string, but the brand
 * stops it being passed where a `UserId` is expected — cheap domain safety
 * with zero runtime cost.
 */
declare const brand: unique symbol;
export type Brand<T, B> = T & { readonly [brand]: B };

export type UserId = Brand<string, "UserId">;
export type SkillId = Brand<string, "SkillId">;
export type SkillVersionId = Brand<string, "SkillVersionId">;
export type TestRunId = Brand<string, "TestRunId">;
export type EvalRunId = Brand<string, "EvalRunId">;

export const UserId = (value: string): UserId => value as UserId;
export const SkillId = (value: string): SkillId => value as SkillId;
export const SkillVersionId = (value: string): SkillVersionId =>
  value as SkillVersionId;
export const TestRunId = (value: string): TestRunId => value as TestRunId;
export const EvalRunId = (value: string): EvalRunId => value as EvalRunId;
