import { parseSubagentDefinition } from "@/modules/subagent-definition";
import type { GatewayTool } from "@/modules/model-gateway";

export const subagentDefinitionTools: readonly GatewayTool[] = [
  { name: "write_subagent_definition", description: "Write the complete subagent definition on a first draft.", parameters: { type: "object", properties: { content: { type: "string" } }, required: ["content"], additionalProperties: false }, handler: (input) => { const content = typeof input.content === "string" ? input.content : ""; const parsed = parseSubagentDefinition(content); return parsed.ok ? { ok: true as const, content } : { ok: false as const, error: parsed.error.message }; } },
  { name: "edit_subagent_definition", description: "Apply a targeted exact-string replacement to the current subagent definition.", parameters: { type: "object", properties: { oldStr: { type: "string" }, newStr: { type: "string" } }, required: ["oldStr", "newStr"], additionalProperties: false }, handler: (input) => ({ ok: true as const, oldStr: typeof input.oldStr === "string" ? input.oldStr : "", newStr: typeof input.newStr === "string" ? input.newStr : "" }) },
];
