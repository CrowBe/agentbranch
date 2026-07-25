import type {
  Concept,
  ConceptClaim,
  ConceptGlossaryTerm,
  DecisionAidOption,
} from "@/modules/concept-library";
import type { Artifact } from "@/modules/skill-analysis";

export type ConceptArtifact = Artifact<"concept"> & {
  readonly concept: Concept;
};

export type ConceptView = {
  readonly id: string;
  readonly title: string;
  readonly kind: Concept["kind"];
  readonly idea: ConceptClaim;
  readonly distinction: ConceptClaim;
  readonly terms: readonly ConceptGlossaryTerm[];
  readonly options: readonly DecisionAidOption[];
};
