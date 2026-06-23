import { serializeSkillMd, type Skill, type SkillSource } from "@/modules/skill";
import type { Analyzer } from "@/modules/skill-analysis";
import { ok } from "@/shared";
import type { HeroArtifact, DocSection } from "./hero.types";

/**
 * Read a skill → emit the hero artifact. Splits the body into markdown
 * sections, each tagged with a source-span into the serialized SKILL.md so
 * either renderer (and later, point-and-annotate) can map back to source.
 */
export const heroAnalyzer: Analyzer<Skill, HeroArtifact> = {
  kind: "hero",
  async analyze(skill: Skill) {
    return ok(createHeroArtifact(skill.source));
  },
};

export function createHeroArtifact(source: SkillSource): HeroArtifact {
  const raw = serializeSkillMd(source);
  return {
    kind: "hero" as const,
    source,
    raw,
    sections: splitSections(source.body, raw),
  };
}

const HEADING = /^(#{1,6})\s+(.*)$/;

/** Break a markdown body into heading-delimited sections with source spans. */
function splitSections(body: string, raw: string): DocSection[] {
  const lines = body.split("\n");
  const sections: DocSection[] = [];
  let current: { heading: string; level: number; lines: string[] } | null = null;
  // Scan-forward cursor: advances past each located needle so duplicate headings
  // resolve to their correct occurrence rather than always the first.
  let cursor = 0;

  const flush = (): void => {
    if (!current) return;
    const text = current.lines.join("\n").trim();
    // Anchor headed sections on the heading text; preamble sections on the body.
    const needle = current.heading !== "" ? current.heading : text;
    const idx = needle ? raw.indexOf(needle, cursor) : -1;
    const start = idx >= 0 ? idx : cursor;
    const end = start + (needle ? needle.length : 0);
    if (idx >= 0) cursor = end;
    sections.push({
      heading: current.heading,
      level: current.level,
      body: text,
      span: { start, end },
    });
  };

  for (const line of lines) {
    const match = HEADING.exec(line);
    if (match) {
      flush();
      current = { heading: match[2]!.trim(), level: match[1]!.length, lines: [] };
    } else {
      current ??= { heading: "", level: 0, lines: [] };
      current.lines.push(line);
    }
  }
  flush();
  return sections.filter((s) => s.heading !== "" || s.body !== "");
}
