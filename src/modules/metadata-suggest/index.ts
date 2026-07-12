/**
 * metadata-suggest — recommended discovery metadata for a skill (category +
 * tags from the taxonomy in @/modules/skill).
 *
 * An analysis capability on the seam, model-backed with a deterministic
 * offline fallback (the visualise posture). The artifact is a *suggestion*:
 * the author accepts, mixes, or edits — `withSkillMetadata` / a build-loop
 * frontmatter edit does the writing, never this module.
 */
import { defineCapability } from "@/modules/skill-analysis";
import { suggestAnalyzer } from "./suggest-analyzer";
import { suggestionsRenderer } from "./renderers";

export const metadataSuggestCapability = defineCapability({
  name: "metadata-suggest",
  analyzer: suggestAnalyzer,
  renderers: { suggestions: suggestionsRenderer },
});

export type {
  SkillMetadataSuggestion,
  SkillMetadataSuggestionView,
} from "./metadata-suggest.types";
