import { describe, expect, it } from "vitest";
import { IMPORT_TIERS, classifyImportDocument } from "./index";

const SKILL = `---
name: inbox-triage
description: Sort unread email into respond, archive, escalate.
---

## Workflow

1. Read the unread mail.
`;

const SUBAGENT = `---
name: invoice-reviewer
description: Reviews supplier invoices before payment.
tools:
  - read_file
model: claude-opus-5
---

You review invoices.
`;

const TOOL_CONTRACT = JSON.stringify({
  name: "fetch_unread_email",
  description: "Fetch unread messages from the inbox.",
  input: { schema: { type: "object", properties: { limit: { type: "number" } } } },
  output: { schema: { type: "object", properties: { messages: { type: "array" } } } },
  failureModes: ["The mailbox is unreachable."],
});

const RESPONSE_SCHEMA = JSON.stringify({
  title: "Triage decision",
  type: "object",
  properties: { action: { type: "string" } },
  required: ["action"],
});

describe("the import ladder", () => {
  it("orders its rungs from least to most complex", () => {
    expect(IMPORT_TIERS.map((rung) => rung.tier)).toEqual([
      "primitive",
      "related-primitives",
      "agent-configuration",
    ]);
  });
});

describe("classifyImportDocument", () => {
  it("recognises a tool contract by its own source model", () => {
    const result = classifyImportDocument(TOOL_CONTRACT);
    expect(result).toMatchObject({ ok: true, kind: "tool-contract", name: "fetch_unread_email" });
  });

  it("recognises a response schema and titles it", () => {
    const result = classifyImportDocument(RESPONSE_SCHEMA);
    expect(result).toMatchObject({ ok: true, kind: "response-schema", name: "Triage decision" });
  });

  it("resolves markdown to a subagent definition when frontmatter says so", () => {
    const result = classifyImportDocument(SUBAGENT);
    expect(result).toMatchObject({ ok: true, kind: "subagent-definition", name: "invoice-reviewer" });
  });

  it("reads plain markdown as a skill but reports the ambiguity", () => {
    const result = classifyImportDocument(SKILL);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.kind).toBe("skill");
    expect(result.name).toBe("inbox-triage");
    // The same bytes are a valid subagent definition; the caller decides.
    expect(result.alternatives).toContain("subagent-definition");
  });

  it("has no alternatives to report when the format is unambiguous", () => {
    const result = classifyImportDocument(SUBAGENT);
    expect(result.ok && result.alternatives).toEqual([]);
  });

  it("honours a narrowed candidate set", () => {
    const result = classifyImportDocument(SKILL, {
      candidates: ["response-schema", "tool-contract", "subagent-definition"],
    });
    expect(result).toMatchObject({ ok: true, kind: "subagent-definition" });
  });

  it("refuses a document no candidate parser accepts", () => {
    const result = classifyImportDocument("just some prose");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("doesn't look like");
  });

  it("names only the candidates it was asked about when it refuses", () => {
    const result = classifyImportDocument("just some prose", { candidates: ["skill"] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("a SKILL.md");
    expect(result.message).not.toContain("tool contract");
  });
});
