import { parseToolContract } from "@/modules/tool-contract";
import type { GatewayTool } from "@/modules/model-gateway";

/**
 * The tool-contract authoring tools, mirroring `write_skill`/`edit_skill` and
 * the response-schema tool pair. `write_tool_contract` streams the whole JSON
 * document on a first draft; `edit_tool_contract` applies an exact string
 * replacement on revisions.
 */
export const toolContractTools: readonly GatewayTool[] = [
  {
    name: "write_tool_contract",
    description: "Write the complete tool contract (one JSON document) on a first draft.",
    parameters: {
      type: "object",
      properties: {
        content: { type: "string", description: "The complete tool-contract JSON document." },
      },
      required: ["content"],
      additionalProperties: false,
    },
    handler: (input) => {
      const content = typeof input.content === "string" ? input.content : "";
      const parsed = parseToolContract(content);
      return parsed.ok
        ? { ok: true as const, content }
        : { ok: false as const, error: parsed.error.message };
    },
  },
  {
    name: "edit_tool_contract",
    description: "Apply a targeted edit to the current tool contract by replacing an exact string.",
    parameters: {
      type: "object",
      properties: {
        oldStr: { type: "string", description: "Exact text to replace." },
        newStr: { type: "string", description: "Replacement text." },
      },
      required: ["oldStr", "newStr"],
      additionalProperties: false,
    },
    handler: (input) => ({
      ok: true as const,
      oldStr: typeof input.oldStr === "string" ? input.oldStr : "",
      newStr: typeof input.newStr === "string" ? input.newStr : "",
    }),
  },
];

export type ToolContractToolName = "write_tool_contract" | "edit_tool_contract";
