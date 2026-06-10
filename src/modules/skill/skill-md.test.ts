import { describe, it, expect } from "vitest";
import { applySkillEdit, parseSkillMd, serializeSkillMd } from "./skill-md";
import { LIMIT_MESSAGES, SKILL_BODY_MAX, SKILL_DESCRIPTION_MAX, SKILL_NAME_MAX, unwrap, isErr } from "@/shared";

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

  it("rejects imported skills that exceed strict skill limits", () => {
    const longName = parseSkillMd(`---\nname: ${"a".repeat(SKILL_NAME_MAX + 1)}\ndescription: d\n---\nbody`);
    expect(isErr(longName)).toBe(true);
    if (isErr(longName)) expect(longName.error.message).toBe(LIMIT_MESSAGES.skillName);

    const longDescription = parseSkillMd(
      `---\nname: n\ndescription: ${"a".repeat(SKILL_DESCRIPTION_MAX + 1)}\n---\nbody`,
    );
    expect(isErr(longDescription)).toBe(true);
    if (isErr(longDescription)) {
      expect(longDescription.error.message).toBe(LIMIT_MESSAGES.skillDescription);
    }

    const longBody = parseSkillMd(`---\nname: n\ndescription: d\n---\n${"a".repeat(SKILL_BODY_MAX + 1)}`);
    expect(isErr(longBody)).toBe(true);
    if (isErr(longBody)) expect(longBody.error.message).toBe(LIMIT_MESSAGES.skillBody);
  });
});

describe("serializeSkillMd", () => {
  it("round-trips a parsed source losslessly", () => {
    const source = unwrap(parseSkillMd(SAMPLE));
    const reparsed = unwrap(parseSkillMd(serializeSkillMd(source)));
    expect(reparsed).toEqual(source);
  });
});

describe("applySkillEdit", () => {
  it("applies replacement text literally when it contains dollar patterns", () => {
    const source = unwrap(parseSkillMd(SAMPLE));
    const edited = unwrap(applySkillEdit(source, "fetch unread mail", "run `$&` literally"));

    expect(edited.body).toContain("run `$&` literally");
    expect(edited.body).not.toContain("run `fetch unread mail` literally");
  });

  it("returns a no-match error when the target text is absent", () => {
    const source = unwrap(parseSkillMd(SAMPLE));
    const result = applySkillEdit(source, "missing text", "replacement");

    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.tag).toBe("edit_no_match");
  });

  it("returns an invalid-skill error when the edit breaks SKILL.md parsing", () => {
    const source = unwrap(parseSkillMd(SAMPLE));
    const result = applySkillEdit(source, "name: inbox-triage", "name: ");

    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.tag).toBe("edit_invalid_skill");
  });
});
