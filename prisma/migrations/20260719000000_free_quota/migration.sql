-- The free tier becomes a free initial quota: one money-denominated spend
-- budget per account, no daily period. Backfill existing spend at the meter's
-- price table (micro-USD per token: input 3, output 15, cache read 0.3,
-- cache write 3.75) so accumulated usage counts against the quota.
ALTER TABLE "usage"
ADD COLUMN "cost_micros_used" INTEGER NOT NULL DEFAULT 0;

UPDATE "usage"
SET "cost_micros_used" = CEIL(
  "input_tokens_used" * 3
  + "output_tokens_used" * 15
  + "cache_read_input_tokens_used" * 0.3
  + "cache_creation_input_tokens_used" * 3.75
);

ALTER TABLE "usage"
DROP COLUMN "period_start";
