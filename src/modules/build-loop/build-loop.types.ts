import type { SkillSource } from "@/modules/skill";
import type { SseEvent } from "@/shared";

/** A chat turn driving the build loop. */
export type BuildMessage = {
  readonly role: "user" | "assistant";
  readonly content: string;
};

export type BuildLoopInput = {
  readonly messages: readonly BuildMessage[];
  /** The skill being revised, if any (absent on first draft). */
  readonly current?: SkillSource;
};

/**
 * The typed events the loop streams to the preview over SSE. The preview is a
 * document model: `skill` replaces it wholesale (write_skill), `skill-edit`
 * patches it (edit_skill) — mirroring Claude Code's Write+Edit (ARCHITECTURE §4).
 */
export type BuildLoopEvent =
  | SseEvent<"text", { readonly delta: string }>
  | SseEvent<"skill", { readonly source: SkillSource }>
  | SseEvent<"skill-edit", { readonly oldStr: string; readonly newStr: string }>
  | SseEvent<"tool", { readonly name: string; readonly phase: "call" | "result" }>
  | SseEvent<"done", { readonly finishReason: string }>
  | SseEvent<"error", { readonly message: string }>;
