-- Publication domain: a public address pins one append-only skill version, its
-- content hash, trust tier, and the automated gate run that reviewed it.
CREATE TABLE "publications" (
  "id" TEXT NOT NULL,
  "publisher_id" TEXT NOT NULL,
  "skill_id" TEXT NOT NULL,
  "skill_version_id" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "tier" TEXT NOT NULL,
  "content_hash" TEXT NOT NULL,
  "gate_verdict" TEXT NOT NULL,
  "gate_run_id" TEXT NOT NULL,
  "harness_version_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "publications_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "publications_slug_key" ON "publications"("slug");
CREATE INDEX "publications_publisher_id_idx" ON "publications"("publisher_id");
CREATE INDEX "publications_skill_version_id_idx" ON "publications"("skill_version_id");
CREATE INDEX "publications_harness_version_id_idx" ON "publications"("harness_version_id");

ALTER TABLE "publications"
  ADD CONSTRAINT "publications_publisher_id_fkey"
  FOREIGN KEY ("publisher_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "publications"
  ADD CONSTRAINT "publications_skill_id_fkey"
  FOREIGN KEY ("skill_id") REFERENCES "skills"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "publications"
  ADD CONSTRAINT "publications_skill_version_id_fkey"
  FOREIGN KEY ("skill_version_id") REFERENCES "skill_versions"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "publications"
  ADD CONSTRAINT "publications_harness_version_id_fkey"
  FOREIGN KEY ("harness_version_id") REFERENCES "harness_versions"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
