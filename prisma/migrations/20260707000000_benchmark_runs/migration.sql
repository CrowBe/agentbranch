-- Frozen regression-benchmark scorings, pinned to the harness version in
-- effect (ARCHITECTURE §9 harness improvement loop).
CREATE TABLE "benchmark_runs" (
  "id" TEXT NOT NULL,
  "harness_version_id" TEXT NOT NULL,
  "benchmark_set_hash" TEXT NOT NULL,
  "score_json" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "benchmark_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "benchmark_runs_harness_version_id_idx" ON "benchmark_runs"("harness_version_id");

ALTER TABLE "benchmark_runs"
  ADD CONSTRAINT "benchmark_runs_harness_version_id_fkey"
  FOREIGN KEY ("harness_version_id") REFERENCES "harness_versions"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
