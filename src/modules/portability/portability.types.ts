/** Non-Claude targets the transform can re-express a skill's intent for. */
export type PortabilityProvider = "chatgpt" | "gemini" | "grok";

/**
 * The transform's output: the skill's intent re-expressed for another target,
 * with an honest account of what Claude-specific scaffolding was dropped.
 * This is *not* a "runs everywhere" claim — it powers the honest portability
 * check ("will my skill survive ChatGPT?", ARCHITECTURE §4).
 */
export type TransformedSkill = {
  readonly provider: PortabilityProvider;
  /** The skill body re-expressed as a system prompt for the target. */
  readonly systemPrompt: string;
  /** Claude-specific scaffolding stripped (frontmatter keys, tool conventions). */
  readonly droppedScaffolding: readonly string[];
  /** Honest caveats about fidelity loss. */
  readonly caveats: readonly string[];
};
