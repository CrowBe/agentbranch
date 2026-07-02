-- Harness manifest identity: source artifacts stay in git; this records the
-- hash identity stamped on future eval/test records.
CREATE TABLE "harness_versions" (
  "id" TEXT NOT NULL,
  "manifest_hash" TEXT NOT NULL,
  "build_loop_system_prompt_hash" TEXT NOT NULL,
  "lint_ruleset_hash" TEXT NOT NULL,
  "prompt_battery_generator_hash" TEXT NOT NULL,
  "test_run_world_generator_hash" TEXT NOT NULL,
  "distractor_library_hash" TEXT NOT NULL,
  "git_sha" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "harness_versions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "harness_versions_manifest_hash_key" ON "harness_versions"("manifest_hash");

ALTER TABLE "eval_runs" ADD COLUMN "harness_version_id" TEXT;
ALTER TABLE "test_runs" ADD COLUMN "harness_version_id" TEXT;

CREATE INDEX "eval_runs_harness_version_id_idx" ON "eval_runs"("harness_version_id");
CREATE INDEX "test_runs_harness_version_id_idx" ON "test_runs"("harness_version_id");

ALTER TABLE "eval_runs"
  ADD CONSTRAINT "eval_runs_harness_version_id_fkey"
  FOREIGN KEY ("harness_version_id") REFERENCES "harness_versions"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "test_runs"
  ADD CONSTRAINT "test_runs_harness_version_id_fkey"
  FOREIGN KEY ("harness_version_id") REFERENCES "harness_versions"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
