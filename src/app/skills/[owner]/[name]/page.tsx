import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { heroCapability } from "@/modules/hero";
import {
  renderSkillProfile,
  type PublicationSafetyRating,
  type TapRepositorySkill,
} from "@/modules/publication";
import { makeSkill } from "@/modules/skill";
import { runCapability } from "@/modules/skill-analysis";
import { getContainer } from "@/server/container";
import { unwrap } from "@/shared";
import { Pill } from "@/components/ui/pill";

export const runtime = "nodejs";
// Publication state must read fresh: a takedown revert or a new safety rating
// has to be visible immediately (ARCHITECTURE §9.1 honesty rules).
export const dynamic = "force-dynamic";

type RouteParams = Promise<{ owner: string; name: string }>;

export async function generateMetadata({ params }: { params: RouteParams }): Promise<Metadata> {
  const skill = await findVisibleSkill(params);
  if (skill === null) return { title: "Skill not found — agent.branch" };
  return {
    title: `${skill.tap.source.frontmatter.name} — agent.branch skill library`,
    description: skill.tap.source.frontmatter.description,
  };
}

export default async function SkillProfilePage({ params }: { params: RouteParams }) {
  const skill = await findVisibleSkill(params);
  if (skill === null) notFound();

  const profile = renderSkillProfile(skill.tap, { safetyRatings: skill.safetyRatings });
  const rendered = unwrap(
    await runCapability(
      heroCapability,
      "rendered",
      makeSkill({
        id: skill.tap.publication.skillId,
        userId: skill.tap.publication.publisherId,
        source: skill.tap.source,
        createdAt: skill.tap.publication.createdAt,
        updatedAt: skill.tap.publication.createdAt,
      }),
    ),
  );

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-8 px-6 py-10">
      <nav>
        <Link href="/" className="text-label text-on-surface-variant hover:opacity-80">
          agent.branch
        </Link>
      </nav>

      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-headline-md">{profile.name}</h1>
          <Pill tone="neutral">{profile.trustLabel}</Pill>
          <Pill tone={profile.safety.status === "safety-badge" ? "success" : "warn"}>
            {profile.safety.label}
          </Pill>
        </div>
        <p className="text-doc-rendered text-on-surface-variant">{profile.description}</p>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-label text-on-surface-variant">by {profile.owner}</span>
          {profile.category && <Pill tone="neutral">{profile.category}</Pill>}
          {profile.tags.map((tag) => (
            <Pill key={tag} tone="neutral">
              #{tag}
            </Pill>
          ))}
        </div>
      </header>

      <section className="flex flex-col gap-1.5 rounded-[var(--radius-sm)] border border-outline-variant bg-surface-high p-4">
        <h2 className="text-label text-on-surface-variant">Install</h2>
        <p className="text-doc-source">
          {profile.install.path} @ {profile.install.ref}
        </p>
        <p className="text-label text-on-surface-variant">
          content hash {profile.contentHash.slice(0, 12)} · published{" "}
          {profile.publishedAt.slice(0, 10)}
        </p>
      </section>

      <article className="flex flex-col gap-5">
        {rendered.sections.map((section, i) => (
          <section key={i} className="flex flex-col gap-1.5">
            {section.heading && <h2 className="text-doc-rendered-h">{section.heading}</h2>}
            <p className="text-doc-rendered whitespace-pre-wrap">{section.body}</p>
          </section>
        ))}
      </article>
    </main>
  );
}

async function findVisibleSkill(params: RouteParams): Promise<{
  readonly tap: TapRepositorySkill;
  readonly safetyRatings: readonly PublicationSafetyRating[];
} | null> {
  const { owner, name } = await params;
  const slug = `${decodeURIComponent(owner)}/${decodeURIComponent(name)}`.toLowerCase();
  const container = getContainer();

  const tapSkills = await container.publications.listTapRepositorySkills();
  if (!tapSkills.ok) return null;

  const tap = tapSkills.value.find(
    (candidate) => candidate.publication.slug.toLowerCase() === slug,
  );
  if (tap === undefined) return null;

  const rating = await container.safetyRatings.latestForVersion(
    tap.publication.skillId,
    tap.publication.publisherId,
    tap.publication.skillVersionId,
  );
  const safetyRatings: PublicationSafetyRating[] =
    rating.ok && rating.value !== null
      ? [
          {
            skillVersionId: rating.value.skillVersionId ?? null,
            verdict: rating.value.verdict,
            ratingId: rating.value.id,
          },
        ]
      : [];

  return { tap, safetyRatings };
}
