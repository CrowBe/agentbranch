-- Publishing is open: publications no longer store an automated gate binding.
-- Existing community-tier rows become published-tier rows.
UPDATE "publications"
SET "tier" = 'published'
WHERE "tier" = 'community';

DROP INDEX IF EXISTS "publications_harness_version_id_idx";

ALTER TABLE "publications"
DROP CONSTRAINT IF EXISTS "publications_harness_version_id_fkey";

ALTER TABLE "publications"
DROP COLUMN IF EXISTS "gate_verdict",
DROP COLUMN IF EXISTS "gate_run_id",
DROP COLUMN IF EXISTS "harness_version_id";
