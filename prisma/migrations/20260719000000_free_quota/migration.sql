-- The free tier becomes a free initial quota: one money-denominated spend
-- budget per account, no daily period. Backfill existing spend at the meter's
-- price table (micro-USD per token: input 3, output 15, cache read 0.3,
-- cache write 3.75) so accumulated usage counts against the quota.
ALTER TABLE "usage"
ADD COLUMN "cost_micros_used" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "usage"
ADD COLUMN "cost_micros_reserved" INTEGER NOT NULL DEFAULT 0;

UPDATE "usage"
SET "cost_micros_used" = CEIL(
  "input_tokens_used" * 3
  + "output_tokens_used" * 15
  + "cache_read_input_tokens_used" * 0.3
  + "cache_creation_input_tokens_used" * 3.75
);

ALTER TABLE "usage"
DROP COLUMN "period_start";

CREATE TABLE "usage_charges" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "price_key" TEXT NOT NULL,
  "cost_micros" INTEGER NOT NULL,
  "input_tokens" INTEGER NOT NULL,
  "output_tokens" INTEGER NOT NULL,
  "cache_read_input_tokens" INTEGER NOT NULL,
  "cache_creation_input_tokens" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "usage_charges_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "usage_charges_user_id_created_at_idx" ON "usage_charges"("user_id", "created_at");
ALTER TABLE "usage_charges" ADD CONSTRAINT "usage_charges_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
