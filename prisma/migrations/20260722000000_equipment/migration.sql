CREATE TABLE "equipment" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "document" TEXT NOT NULL,
  "content_hash" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "equipment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "equipment_user_id_kind_name_key" ON "equipment"("user_id", "kind", "name");
CREATE INDEX "equipment_user_id_idx" ON "equipment"("user_id");
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
