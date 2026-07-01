-- Branch/promote iteration substrate (ARCHITECTURE §6, §9.3; issue #128).
-- Moves versioning from linear latest-head to draft / main / promote:
--   * skills gain an explicit blessed pointer (main_version_id);
--   * skill_versions gain a branch + parent pointer (a DAG);
--   * revision becomes a per-branch display ordinal (unique per branch, not skill).
-- The backfill makes the change safe against existing rows: every skill with
-- history gets one "main" branch holding its current linear lineage, the blessed
-- pointer is set to the newest revision (today's implicit head made explicit),
-- and parents chain by revision — so existing linear-history reads keep working.

-- 1. New nullable columns (filled by the backfill before any NOT NULL/constraints).
ALTER TABLE "skills" ADD COLUMN "main_version_id" TEXT;
ALTER TABLE "skill_versions" ADD COLUMN "branch_id" TEXT;
ALTER TABLE "skill_versions" ADD COLUMN "parent_id" TEXT;

-- 2. The branch table.
CREATE TABLE "skill_branches" (
    "id" TEXT NOT NULL,
    "skill_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "ordinal" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "skill_branches_pkey" PRIMARY KEY ("id")
);

-- 3. Backfill: one main branch per skill that has any versions.
INSERT INTO "skill_branches" ("id", "skill_id", "status", "ordinal", "created_at", "updated_at")
SELECT gen_random_uuid()::text, s."id", 'open', 0, now(), now()
FROM "skills" s
WHERE EXISTS (SELECT 1 FROM "skill_versions" v WHERE v."skill_id" = s."id");

-- 4. Point every existing version at its skill's (single) main branch.
UPDATE "skill_versions" sv
SET "branch_id" = b."id"
FROM "skill_branches" b
WHERE b."skill_id" = sv."skill_id";

-- 5. Chain parents by the old per-skill monotonic revision.
UPDATE "skill_versions" sv
SET "parent_id" = prev."id"
FROM "skill_versions" prev
WHERE prev."skill_id" = sv."skill_id"
  AND prev."revision" = sv."revision" - 1;

-- 6. The blessed pointer is the newest revision (implicit head → explicit).
UPDATE "skills" s
SET "main_version_id" = (
    SELECT v."id" FROM "skill_versions" v
    WHERE v."skill_id" = s."id"
    ORDER BY v."revision" DESC
    LIMIT 1
);

-- 7. Now branch_id is guaranteed populated for all rows.
ALTER TABLE "skill_versions" ALTER COLUMN "branch_id" SET NOT NULL;

-- 8. Revision uniqueness moves from per-skill to per-branch.
DROP INDEX "skill_versions_skill_id_revision_key";
CREATE UNIQUE INDEX "skill_versions_branch_id_revision_key" ON "skill_versions"("branch_id", "revision");
CREATE INDEX "skill_versions_skill_id_idx" ON "skill_versions"("skill_id");
CREATE INDEX "skill_versions_branch_id_idx" ON "skill_versions"("branch_id");
CREATE INDEX "skill_branches_skill_id_idx" ON "skill_branches"("skill_id");
CREATE UNIQUE INDEX "skills_main_version_id_key" ON "skills"("main_version_id");

-- 9. Foreign keys. Pruning a draft version releases pins via ON DELETE SET NULL.
ALTER TABLE "skills" ADD CONSTRAINT "skills_main_version_id_fkey" FOREIGN KEY ("main_version_id") REFERENCES "skill_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "skill_branches" ADD CONSTRAINT "skill_branches_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "skills"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "skill_versions" ADD CONSTRAINT "skill_versions_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "skill_branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "skill_versions" ADD CONSTRAINT "skill_versions_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "skill_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
