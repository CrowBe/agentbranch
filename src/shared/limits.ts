export const SKILL_NAME_MAX = 100;
export const SKILL_DESCRIPTION_MAX = 1024;
export const SKILL_BODY_MAX = 50_000;
export const MESSAGE_CONTENT_MAX = 16_000;
export const MESSAGES_MAX = 100;
export const REQUEST_BYTES_MAX = 256_000;

export const LIMIT_MESSAGES = {
  skillName: `Skill names need to stay under ${SKILL_NAME_MAX} characters.`,
  skillDescription: `Skill descriptions need to stay under ${SKILL_DESCRIPTION_MAX} characters.`,
  skillBody: `This skill is longer than we can build in one go - trim it to under ${SKILL_BODY_MAX.toLocaleString("en-US")} characters and try again.`,
  messageContent: `This message is longer than we can build from in one go - trim it to under ${MESSAGE_CONTENT_MAX.toLocaleString("en-US")} characters and try again.`,
  messages: `This conversation has too many messages - keep it to ${MESSAGES_MAX} messages or fewer and try again.`,
  requestBytes: `This request is too large - keep it under ${REQUEST_BYTES_MAX.toLocaleString("en-US")} bytes and try again.`,
} as const;
