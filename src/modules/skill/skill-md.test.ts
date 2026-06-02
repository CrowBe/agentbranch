import { describe, it, expect } from "vitest";
import { parseSkillMd, serializeSkillMd } from "./skill-md";
import { unwrap, isErr } from "@/shared";

const SAMPLE = `---
name: inbox-triage
description: Sorts unread email into respond / archive / escalate.
allowed-tools:
  - read_email
---

# Inbox triage

When the user asks to clear their inbox, fetch unread mail and sort it.
`;

describe("parseSkillMd", () => {
  it("extracts name, description and preserves extra frontmatter", () => {
    const source = unwrap(parseSkillMd(SAMPLE));
    expect(source.frontmatter.name).toBe("inbox-triage");
    expect(source.frontmatter.description).toContain("Sorts unread email");
    expect(source.frontmatter.extra).toEqual({ "allowed-tools": ["read_email"] });
    expect(source.body).toContain("# Inbox triage");
  });

  it("fails when name is missing", () => {
    const result = parseSkillMd(`---\ndescription: x\n---\nbody`);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.tag).toBe("missing_name");
  });

  it("fails when description is missing", () => {
    const result = parseSkillMd(`---\nname: x\n---\nbody`);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.tag).toBe("missing_description");
  });

  it("fails on malformed YAML", () => {
    const result = parseSkillMd(`---\nname: : :\n bad\n---\nbody`);
    expect(isErr(result)).toBe(true);
  });
});

describe("serializeSkillMd", () => {
  it("round-trips a parsed source losslessly", () => {
    const source = unwrap(parseSkillMd(SAMPLE));
    const reparsed = unwrap(parseSkillMd(serializeSkillMd(source)));
    expect(reparsed).toEqual(source);
  });
});
