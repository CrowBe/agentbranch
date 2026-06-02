import { serializeSkillMd, type Skill } from "@/modules/skill";
import type { Analyzer } from "@/modules/skill-analysis";
import { ok } from "@/shared";
import type { HeroArtifact, DocSection } from "./hero.types";

/**
 * Read a skill → emit the hero artifact. Splits the body into markdown
 * sections, each tagged with a source-span into the serialized SKILL.md so
 * either renderer (and later, point-and-annotate) can map back to source.
 */
export const heroAnalyzer: Analyzer<HeroArtifact> = {
  kind: "hero",
  async analyze(skill: Skill) {
    const raw = serializeSkillMd(skill.source);
    return ok({
      kind: "hero" as const,
      source: skill.source,
      raw,
      sections: splitSections(skill.source.body, raw),
    });
  },
};

const HEADING = /^(#{1,6})\s+(.*)$/;

/** Break a markdown body into heading-delimited sections with source spans. */
function splitSections(body: string, raw: string): DocSection[] {
  const lines = body.split("\n");
  const sections: DocSection[] = [];
  let current: { heading: string; level: number; lines: string[] } | null = null;

  const flush = (): void => {
    if (!current) return;
    const text = current.lines.join("\n").trim();
    const start = raw.indexOf(current.heading === "" ? text : current.heading);
    sections.push({
      heading: current.heading,
      level: current.level,
      body: text,
      span: { start: Math.max(start, 0), end: Math.max(start, 0) + text.length },
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
