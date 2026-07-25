import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CONCEPT_GLOSSARY,
  CONCEPT_GLOSSARY_TERMS,
  conceptLibrary,
  type ConceptClaim,
} from "./index";

const root = resolve(import.meta.dirname, "../../..");

describe("concept library", () => {
  it("ships four definitions and the primitive decision aid", () => {
    expect(conceptLibrary).toHaveLength(5);
    expect(new Set(conceptLibrary.map(({ id }) => id))).toHaveLength(5);
    expect(conceptLibrary.filter(({ kind }) => kind === "definition")).toHaveLength(4);
    expect(conceptLibrary.filter(({ kind }) => kind === "decision-aid")).toHaveLength(1);
  });

  it("keeps the concept shape thin and every claim cited", () => {
    for (const concept of conceptLibrary) {
      expect(concept.version).toBe(1);
      expect(concept.idea.text.length).toBeLessThanOrEqual(180);
      expect(concept.distinction.text.length).toBeLessThanOrEqual(220);
      expectClaimCited(concept.idea);
      expectClaimCited(concept.distinction);

      if (concept.kind === "decision-aid") {
        expect(concept.options).toHaveLength(4);
        for (const option of concept.options) {
          expect(option.useWhen.text.length).toBeLessThanOrEqual(120);
          expectClaimCited(option.useWhen);
        }
      }
    }
  });

  it("resolves every citation to a repo-tracked primary source section", () => {
    for (const concept of conceptLibrary) {
      for (const citation of citationsFor(concept)) {
        const source = readFileSync(resolve(root, citation.source), "utf8");
        expect(source, `${concept.id}: ${citation.source}#${citation.section}`).toContain(
          citation.section,
        );
      }
    }
  });

  it("uses only glossary terms that exist verbatim in CONTEXT.md", () => {
    const context = readFileSync(resolve(root, "CONTEXT.md"), "utf8");

    for (const term of CONCEPT_GLOSSARY_TERMS) {
      expect(context).toContain(`**${term}**:`);
    }

    for (const concept of conceptLibrary) {
      for (const term of concept.terms) {
        expect(CONCEPT_GLOSSARY_TERMS).toContain(term);
        expect(textFor(concept)).toContain(term);
      }
    }
  });

  it("keeps the reviewed glossary definitions verbatim with CONTEXT.md", () => {
    const context = readFileSync(resolve(root, "CONTEXT.md"), "utf8");
    for (const term of CONCEPT_GLOSSARY_TERMS) {
      const marker = `**${term}**:\n`;
      const start = context.indexOf(marker);
      expect(start, term).toBeGreaterThanOrEqual(0);
      const definition = context
        .slice(start + marker.length)
        .split("\n", 1)[0];
      expect(CONCEPT_GLOSSARY[term]).toBe(definition);
    }
  });

  it("pins each content hash to the complete seed", () => {
    for (const { contentHash, ...seed } of conceptLibrary) {
      expect(contentHash).toBe(
        createHash("sha256").update(JSON.stringify(seed)).digest("hex"),
      );
    }
  });
});

function expectClaimCited(claim: ConceptClaim): void {
  expect(claim.text.trim()).not.toBe("");
  expect(claim.citations.length).toBeGreaterThan(0);
}

function citationsFor(concept: (typeof conceptLibrary)[number]) {
  const claims = [concept.idea, concept.distinction];
  if (concept.kind === "decision-aid") {
    claims.push(...concept.options.map(({ useWhen }) => useWhen));
  }
  return claims.flatMap(({ citations }) => citations);
}

function textFor(concept: (typeof conceptLibrary)[number]): string {
  const claims = [concept.title, concept.idea.text, concept.distinction.text];
  if (concept.kind === "decision-aid") {
    claims.push(...concept.options.flatMap(({ term, useWhen }) => [term, useWhen.text]));
  }
  return claims.join("\n");
}
