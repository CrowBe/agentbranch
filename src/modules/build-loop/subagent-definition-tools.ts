import { parseSubagentDefinition, serializeSubagentDefinition, type SubagentDefinitionSource } from "@/modules/subagent-definition";
import type { GatewayTool } from "@/modules/model-gateway";

export function createSubagentDefinitionTools(current?: SubagentDefinitionSource): readonly GatewayTool[] {
  let draft = current ? serializeSubagentDefinition(current) : null;
  return [
    {
      name: "write_subagent_definition",
      description: "Write the complete subagent definition on a first draft.",
      parameters: { type: "object", properties: { content: { type: "string" } }, required: ["content"], additionalProperties: false },
      handler: (input) => {
        const content = typeof input.content === "string" ? input.content : "";
        const parsed = parseSubagentDefinition(content);
        if (!parsed.ok) return { ok: false as const, error: parsed.error.message };
        draft = serializeSubagentDefinition(parsed.value);
        return { ok: true as const, content };
      },
    },
    {
      name: "edit_subagent_definition",
      description: "Apply a targeted exact-string replacement to the current subagent definition. If no draft exists, call write_subagent_definition instead.",
      parameters: { type: "object", properties: { oldStr: { type: "string" }, newStr: { type: "string" } }, required: ["oldStr", "newStr"], additionalProperties: false },
      handler: (input) => {
        if (!draft) return { ok: false as const, error: "No draft exists to edit yet. Call write_subagent_definition first." };
        const oldStr = typeof input.oldStr === "string" ? input.oldStr : "";
        const newStr = typeof input.newStr === "string" ? input.newStr : "";
        if (!draft.includes(oldStr)) return { ok: false as const, error: "The exact text to replace was not found." };
        const parsed = parseSubagentDefinition(draft.replace(oldStr, newStr));
        if (!parsed.ok) return { ok: false as const, error: parsed.error.message };
        draft = serializeSubagentDefinition(parsed.value);
        return { ok: true as const, oldStr, newStr };
      },
    },
  ];
}
