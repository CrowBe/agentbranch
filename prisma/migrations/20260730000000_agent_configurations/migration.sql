CREATE TABLE "agent_configurations" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "main_version_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "agent_configurations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "agent_configuration_versions" (
  "id" TEXT NOT NULL,
  "configuration_id" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "snapshot_json" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "agent_configuration_versions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "agent_configuration_drafts" (
  "configuration_id" TEXT NOT NULL,
  "base_version_id" TEXT NOT NULL,
  "snapshot_json" JSONB NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "agent_configuration_drafts_pkey" PRIMARY KEY ("configuration_id")
);

CREATE UNIQUE INDEX "agent_configurations_main_version_id_key" ON "agent_configurations"("main_version_id");
CREATE INDEX "agent_configurations_user_id_idx" ON "agent_configurations"("user_id");
CREATE UNIQUE INDEX "agent_configuration_versions_configuration_id_revision_key" ON "agent_configuration_versions"("configuration_id", "revision");
CREATE INDEX "agent_configuration_versions_configuration_id_idx" ON "agent_configuration_versions"("configuration_id");
CREATE INDEX "agent_configuration_drafts_base_version_id_idx" ON "agent_configuration_drafts"("base_version_id");

ALTER TABLE "agent_configurations" ADD CONSTRAINT "agent_configurations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_configurations" ADD CONSTRAINT "agent_configurations_main_version_id_fkey" FOREIGN KEY ("main_version_id") REFERENCES "agent_configuration_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "agent_configuration_versions" ADD CONSTRAINT "agent_configuration_versions_configuration_id_fkey" FOREIGN KEY ("configuration_id") REFERENCES "agent_configurations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_configuration_drafts" ADD CONSTRAINT "agent_configuration_drafts_configuration_id_fkey" FOREIGN KEY ("configuration_id") REFERENCES "agent_configurations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_configuration_drafts" ADD CONSTRAINT "agent_configuration_drafts_base_version_id_fkey" FOREIGN KEY ("base_version_id") REFERENCES "agent_configuration_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
