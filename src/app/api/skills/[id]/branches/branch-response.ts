import { createLintSummary } from "@/modules/lint";
import type { SkillBranch, SkillVersion } from "@/modules/skill";

/** Shape a draft + its head for the client so the hero can switch to it. */
export function branchDetail(branch: SkillBranch, head: SkillVersion) {
  return {
    id: branch.id,
    isMain: branch.isMain,
    status: branch.status,
    ordinal: branch.ordinal,
    revision: head.revision,
    source: head.source,
    lintSummary: head.lintSummary ?? createLintSummary(head.source),
  };
}
