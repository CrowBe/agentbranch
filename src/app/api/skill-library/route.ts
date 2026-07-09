import { renderSkillLibrary, type SkillLibrarySurface } from "@/modules/publication";
import { getContainer } from "@/server/container";
import { isErr } from "@/shared";
import { domainErrorResponse } from "../_shared/skill-request";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const surface = parseSurface(url.searchParams.get("surface"));
  const query = url.searchParams.get("q") ?? undefined;
  const slug = url.searchParams.get("slug") ?? undefined;

  const publications = await getContainer().publications.listVisible();
  if (isErr(publications)) return domainErrorResponse(publications.error);

  return Response.json(renderSkillLibrary(publications.value, { surface, query, slug }));
}

function parseSurface(value: string | null): SkillLibrarySurface {
  return value === "templates" ? "templates" : "library";
}
