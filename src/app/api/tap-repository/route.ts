import { renderTapRepositoryFiles } from "@/modules/publication";
import { getContainer } from "@/server/container";
import { isErr, type SafetyRatingId, type SkillVersionId } from "@/shared";
import { domainErrorResponse } from "../_shared/skill-request";

export const runtime = "nodejs";

/**
 * Public tap repository snapshot. The bot publish pipeline can use this file
 * set as the source of truth for the auto-merged PR it opens against the tap.
 */
export async function GET(): Promise<Response> {
  const container = getContainer();
  const skills = await container.publications.listTapRepositorySkills();
  if (isErr(skills)) return domainErrorResponse(skills.error);

  const safetyRatingResults = await Promise.all(
    skills.value.map(async ({ publication }) => {
      const rating = await container.safetyRatings.latestForVersion(
        publication.skillId,
        publication.publisherId,
        publication.skillVersionId,
      );
      if (isErr(rating)) return rating;
      return {
        ok: true as const,
        value: {
          skillVersionId: rating.value?.skillVersionId ?? (null as SkillVersionId | null),
          verdict: rating.value?.verdict ?? ("needs-review" as const),
          ratingId: rating.value?.id ?? (null as SafetyRatingId | null),
        },
      };
    }),
  );

  const safetyRatings = [];
  for (const rating of safetyRatingResults) {
    if (isErr(rating)) return domainErrorResponse(rating.error);
    safetyRatings.push(rating.value);
  }

  const files = renderTapRepositoryFiles(
    skills.value,
    safetyRatings.filter((rating): rating is {
      readonly skillVersionId: SkillVersionId;
      readonly verdict: "passed" | "needs-review" | "blocked";
      readonly ratingId: SafetyRatingId;
    } => rating.skillVersionId !== null && rating.ratingId !== null),
  );
  if (isErr(files)) return domainErrorResponse(files.error);

  return Response.json({
    files: files.value,
  });
}
