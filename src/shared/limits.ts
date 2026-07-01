export const SKILL_NAME_MAX = 100;
export const SKILL_DESCRIPTION_MAX = 1024;
export const SKILL_BODY_MAX = 50_000;
export const SKILL_VERSION_MAX = 10;
/** Open drafts per skill the daily retention job tidies down to (ARCHITECTURE
 * §9.3) — the bounded-by-construction shape of the free-tier skill-count cap. */
export const OPEN_DRAFTS_MAX = 10;
export const MESSAGE_CONTENT_MAX = 16_000;
export const MESSAGES_MAX = 100;
export const REQUEST_BYTES_MAX = 256_000;
export const FRONTMATTER_JSON_MAX_BYTES = REQUEST_BYTES_MAX;
export const FRONTMATTER_JSON_MAX_DEPTH = 16;
export const FRONTMATTER_JSON_MAX_KEYS = 200;
export const SKILL_COUNT_LIMITS = {
  free: 1,
  pro: 100,
} as const;

export const LIMIT_MESSAGES = {
  skillName: `Skill names need to stay under ${SKILL_NAME_MAX} characters.`,
  skillDescription: `Skill descriptions need to stay under ${SKILL_DESCRIPTION_MAX} characters.`,
  skillBody: `This skill is longer than we can build in one go - trim it to under ${SKILL_BODY_MAX.toLocaleString("en-US")} characters and try again.`,
  frontmatterJson: `Extra frontmatter needs to stay under ${FRONTMATTER_JSON_MAX_BYTES.toLocaleString("en-US")} bytes, ${FRONTMATTER_JSON_MAX_DEPTH} levels, and ${FRONTMATTER_JSON_MAX_KEYS} keys.`,
  unsafeFrontmatterKey:
    "Frontmatter cannot include `__proto__`, `constructor`, or `prototype` keys.",
  messageContent: `This message is longer than we can build from in one go - trim it to under ${MESSAGE_CONTENT_MAX.toLocaleString("en-US")} characters and try again.`,
  messages: `This conversation has too many messages - keep it to ${MESSAGES_MAX} messages or fewer and try again.`,
  requestBytes: `This request is too large - keep it under ${REQUEST_BYTES_MAX.toLocaleString("en-US")} bytes and try again.`,
  skillCount:
    "You're at your skill limit - delete a skill to make room, or upgrade for more.",
} as const;
