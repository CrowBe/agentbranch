import { describe, expect, it } from "vitest";
import { parseSkillMd, serializeSkillMd } from "./skill-md";
import {
  SKILL_TAGS_MAX,
  isSkillCategory,
  normalizeSkillTags,
  skillMetadata,
  withSkillMetadata,
} from "./skill-metadata";
import { unwrap } from "@/shared";

const SOURCE_WITH_METADATA = `---
name: inbox-triage
description: Triage unread email into reply, delegate, or archive.
category: email
tags:
  - triage
  - inbox
---

## When to use
Sort unread email.
`;

const SOURCE_WITHOUT_METADATA = `---
name: inbox-triage
description: Triage unread email into reply, delegate, or archive.
---

## When to use
Sort unread email.
`;

describe("skill metadata", () => {
  it("reads category and tags from frontmatter extra keys", () => {
    const source = unwrap(parseSkillMd(SOURCE_WITH_METADATA));
    expect(skillMetadata(source)).toEqual({ category: "email", tags: ["triage", "inbox"] });
  });

  it("reads absent metadata as null category and no tags", () => {
    const source = unwrap(parseSkillMd(SOURCE_WITHOUT_METADATA));
    expect(skillMetadata(source)).toEqual({ category: null, tags: [] });
  });

  it("reads comma-separated string tags for imported skills", () => {
    const source = unwrap(parseSkillMd(SOURCE_WITHOUT_METADATA));
    const withStringTags = {
      ...source,
      frontmatter: {
        ...source.frontmatter,
        extra: { tags: "Triage, inbox , " },
      },
    };
    expect(skillMetadata(withStringTags).tags).toEqual(["Triage", "inbox"]);
  });

  it("writes normalized metadata that round-trips through SKILL.md", () => {
    const source = unwrap(parseSkillMd(SOURCE_WITHOUT_METADATA));
    const updated = withSkillMetadata(source, {
      category: "email",
      tags: ["Inbox Zero", "triage", "triage", "  "],
    });

    expect(skillMetadata(updated)).toEqual({ category: "email", tags: ["inbox-zero", "triage"] });
    const reparsed = unwrap(parseSkillMd(serializeSkillMd(updated)));
    expect(skillMetadata(reparsed)).toEqual({ category: "email", tags: ["inbox-zero", "triage"] });
    expect(reparsed.body).toBe(source.body);
  });

  it("removes metadata keys when cleared so frontmatter stays clean", () => {
    const source = unwrap(parseSkillMd(SOURCE_WITH_METADATA));
    const cleared = withSkillMetadata(source, { category: null, tags: [] });
    expect(cleared.frontmatter.extra).not.toHaveProperty("category");
    expect(cleared.frontmatter.extra).not.toHaveProperty("tags");
  });

  it("caps and dedupes tags at the structural bound", () => {
    const tags = Array.from({ length: 12 }, (_, i) => `tag-${i}`);
    expect(normalizeSkillTags(tags)).toHaveLength(SKILL_TAGS_MAX);
  });

  it("validates categories against the closed taxonomy", () => {
    expect(isSkillCategory("email")).toBe(true);
    expect(isSkillCategory("blockchain")).toBe(false);
    expect(isSkillCategory(null)).toBe(false);
  });
});
