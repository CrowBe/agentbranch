import { renderSkillLibrary, type SkillLibrarySurface } from "@/modules/publication";
import { getContainer } from "@/server/container";
import { isErr, type SafetyRatingId, type SkillVersionId } from "@/shared";
import { domainErrorResponse } from "../_shared/skill-request";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const surface = parseSurface(url.searchParams.get("surface"));
  const query = url.searchParams.get("q") ?? undefined;
  const slug = url.searchParams.get("slug") ?? undefined;
  const container = getContainer();

  const publications = await container.publications.listVisible();
  if (isErr(publications)) return domainErrorResponse(publications.error);

  const safetyRatingResults = await Promise.all(
    publications.value.map(async (publication) => {
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

  return Response.json(
    renderSkillLibrary(publications.value, {
      surface,
      query,
      slug,
      safetyRatings: safetyRatings
        .filter((rating): rating is {
          readonly skillVersionId: SkillVersionId;
          readonly verdict: "passed" | "needs-review" | "blocked";
          readonly ratingId: SafetyRatingId;
        } => rating.skillVersionId !== null && rating.ratingId !== null),
    }),
  );
}

function parseSurface(value: string | null): SkillLibrarySurface {
  return value === "templates" ? "templates" : "library";
}
