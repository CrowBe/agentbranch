import type { MockTool, MockToolRegistry } from "./test-run.types";

/** In-memory mock-tool registry. Tools are auto-inferred from the skill in v1
 * (ARCHITECTURE §4); this seeds the email integration the slice ships with. */
export function createMockToolRegistry(seed: readonly MockTool[] = []): MockToolRegistry {
  const tools = new Map<string, MockTool>();
  for (const tool of seed) tools.set(tool.name, tool);
  return {
    list: () => [...tools.values()],
    get: (name) => tools.get(name),
    register: (tool) => {
      tools.set(tool.name, tool);
    },
  };
}

/** The email mock — the first integration the v1 test run ships with (§5.4). */
export const emailMockTool: MockTool = {
  name: "read_email",
  description: "Returns mocked unread email so a skill can be exercised end-to-end.",
  respond: () => ({
    unread: [
      {
        from: "billing@vendor.example",
        subject: "Invoice #4821 overdue",
        snippet: "Your payment of $240 is 6 days overdue…",
      },
      {
        from: "newsletter@news.example",
        subject: "This week in AI",
        snippet: "The five stories that mattered…",
      },
    ],
  }),
};

/** The default registry the composition root hands to a test run. */
export const defaultMockToolRegistry = (): MockToolRegistry =>
  createMockToolRegistry([emailMockTool]);
