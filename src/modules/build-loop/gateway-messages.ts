import type { GatewayMessage } from "@/modules/model-gateway";
import type { BuildMessage } from "./build-loop.types";

/**
 * Mark the latest turn as the conversation's cache boundary. With the frozen
 * system prompt cached ahead of it, each turn re-reads the prior conversation
 * from cache and pays full price only for the newest message.
 */
export function withLatestMessageCacheControl(
  messages: readonly BuildMessage[],
): readonly GatewayMessage[] {
  const lastIndex = messages.length - 1;
  return messages.map((message, index) => ({
    role: message.role,
    content: message.content,
    ...(index === lastIndex ? { cacheControl: { type: "ephemeral" } as const } : {}),
  }));
}
