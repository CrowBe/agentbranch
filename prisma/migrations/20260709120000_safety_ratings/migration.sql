-- Recorded safety ratings: the opt-in safety review's Evaluation record,
-- pinned to the skill version it reviewed (ARCHITECTURE §6, §9.1).
CREATE TABLE "safety_ratings" (
  "id" TEXT NOT NULL,
  "skill_id" TEXT NOT NULL,
  "skill_version_id" TEXT,
  "harness_version_id" TEXT,
  "user_id" TEXT NOT NULL,
  "verdict" TEXT NOT NULL,
  "result_json" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "safety_ratings_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "safety_ratings_skill_id_idx" ON "safety_ratings"("skill_id");
CREATE INDEX "safety_ratings_skill_version_id_idx" ON "safety_ratings"("skill_version_id");
CREATE INDEX "safety_ratings_harness_version_id_idx" ON "safety_ratings"("harness_version_id");

ALTER TABLE "safety_ratings"
  ADD CONSTRAINT "safety_ratings_skill_id_fkey"
  FOREIGN KEY ("skill_id") REFERENCES "skills"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "safety_ratings"
  ADD CONSTRAINT "safety_ratings_skill_version_id_fkey"
  FOREIGN KEY ("skill_version_id") REFERENCES "skill_versions"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "safety_ratings"
  ADD CONSTRAINT "safety_ratings_harness_version_id_fkey"
  FOREIGN KEY ("harness_version_id") REFERENCES "harness_versions"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "safety_ratings"
  ADD CONSTRAINT "safety_ratings_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
