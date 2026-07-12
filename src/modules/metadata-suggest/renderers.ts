import type { Renderer } from "@/modules/skill-analysis";
import type {
  SkillMetadataSuggestion,
  SkillMetadataSuggestionView,
} from "./metadata-suggest.types";

/** The workspace's suggestion surface: what to offer, next to what exists. */
export const suggestionsRenderer: Renderer<SkillMetadataSuggestion, SkillMetadataSuggestionView> = {
  target: "suggestions",
  render(artifact) {
    return {
      category: artifact.category,
      tags: artifact.tags,
      rationale: artifact.rationale,
      current: artifact.current,
    };
  },
};
