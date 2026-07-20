import { describe, expect, it } from "vitest";
import { runCapability } from "@/modules/skill-analysis";
import { isErr, unwrap } from "@/shared";
import { createSubagentDefinitionLintReport, parseSubagentDefinition, serializeSubagentDefinition, subagentDefinitionCapability } from "./index";

const CLEAN = `---
name: invoice-reviewer
description: Reviews invoice records for inconsistencies and delegates only when a finance specialist is needed.
tools:
  - read_invoice
model: claude-sonnet-4-5
x-owner: finance
---

You are an invoice review specialist responsible for finding inconsistent totals and dates.

Review each supplied invoice, cite the fields behind every finding, and return a concise list of discrepancies. Only use read_invoice for the invoice named by the caller. Never modify or send records.`;

const FLAWED = `---
name: Invoice Helper
description: Helps.
tools:
  - "*"
model: "??? model"
---

Check it.`;

describe("subagent definition source model", () => {
  it("round-trips fixtures while preserving optional and unknown frontmatter", () => {
    for (const fixture of [CLEAN, FLAWED]) {
      const source = unwrap(parseSubagentDefinition(fixture));
      expect(unwrap(parseSubagentDefinition(serializeSubagentDefinition(source)))).toEqual(source);
    }
    expect(unwrap(parseSubagentDefinition(CLEAN)).frontmatter.extra).toEqual({ "x-owner": "finance" });
  });

  it("rejects missing required fields, malformed tools, and unsafe keys", () => {
    expect(isErr(parseSubagentDefinition("plain markdown"))).toBe(true);
    expect(isErr(parseSubagentDefinition("---\ndescription: work\n---\nbody"))).toBe(true);
    expect(isErr(parseSubagentDefinition("---\nname: helper\ndescription: work\ntools: all\n---\nbody"))).toBe(true);
    expect(isErr(parseSubagentDefinition("---\nname: helper\ndescription: work\nx:\n  constructor: bad\n---\nbody"))).toBe(true);
  });
});

describe("subagent definition lint", () => {
  it("keeps a meaningful grade spread between clean and flawed fixtures", () => {
    const clean = createSubagentDefinitionLintReport(unwrap(parseSubagentDefinition(CLEAN)));
    const flawed = createSubagentDefinitionLintReport(unwrap(parseSubagentDefinition(FLAWED)));
    expect(clean.summary).toMatchObject({ score: 100, grade: "A" });
    expect(flawed.summary.score).toBeLessThanOrEqual(20);
    expect(clean.summary.score - flawed.summary.score).toBeGreaterThan(5);
    expect(flawed.findings.map((finding) => finding.rule)).toEqual(expect.arrayContaining(["subagent.name.format", "subagent.description.thin", "subagent.instructions.thin", "subagent.role.missing", "subagent.tools.over-broad", "subagent.model.unknown-shape"]));
  });

  it("renders Insights and Breakdown through the seam", async () => {
    const source = unwrap(parseSubagentDefinition(CLEAN));
    expect(unwrap(await runCapability(subagentDefinitionCapability, "insights", source)).grade).toBe("A");
    expect(unwrap(await runCapability(subagentDefinitionCapability, "breakdown", source)).findings).toEqual([]);
  });
});
