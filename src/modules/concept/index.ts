/**
 * concept — a pure, offline projection of a reviewed concept kernel onto the
 * skill-analysis seam. The renderer returns structured data so presentation
 * surfaces can apply the live design tokens without trusting authored HTML.
 */
import type { Concept } from "@/modules/concept-library";
import { defineCapability } from "@/modules/skill-analysis";
import { ok } from "@/shared";
import type { ConceptArtifact, ConceptView } from "./concept.types";

export const conceptCapability = defineCapability({
  name: "concept",
  analyzer: {
    kind: "concept" as const,
    async analyze(concept: Concept) {
      return ok<ConceptArtifact>({ kind: "concept", concept });
    },
  },
  renderers: {
    rendered: {
      target: "rendered",
      render: (artifact: ConceptArtifact): ConceptView => ({
        id: artifact.concept.id,
        title: artifact.concept.title,
        kind: artifact.concept.kind,
        idea: artifact.concept.idea,
        distinction: artifact.concept.distinction,
        terms: artifact.concept.terms,
        options:
          artifact.concept.kind === "decision-aid"
            ? artifact.concept.options
            : [],
      }),
    },
  },
});

export type { ConceptArtifact, ConceptView } from "./concept.types";
