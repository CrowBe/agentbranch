ALTER TABLE "harness_versions" ADD COLUMN "response_schema_lint_ruleset_hash" TEXT NOT NULL DEFAULT '';
ALTER TABLE "harness_versions" ADD COLUMN "tool_contract_lint_ruleset_hash" TEXT NOT NULL DEFAULT '';
ALTER TABLE "harness_versions" ADD COLUMN "subagent_definition_lint_ruleset_hash" TEXT NOT NULL DEFAULT '';
ALTER TABLE "harness_versions" ADD COLUMN "equipment_authoring_prompts_hash" TEXT NOT NULL DEFAULT '';
ALTER TABLE "harness_versions" ADD COLUMN "safety_review_judge_hash" TEXT NOT NULL DEFAULT '';
ALTER TABLE "harness_versions" ADD COLUMN "adversarial_negative_battery_hash" TEXT NOT NULL DEFAULT '';
