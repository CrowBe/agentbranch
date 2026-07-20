import {
  baselineSkillCorpus,
  type BaselineSkillCorpusEntry,
} from "@/modules/baseline-corpus";
import {
  responseSchemaCorpus,
  type ResponseSchemaCorpusEntry,
} from "@/modules/response-schema-corpus";
import { toolContractCorpus, type ToolContractCorpusEntry } from "./index";

export type ToolContractBundleFixture = {
  readonly id: string;
  readonly skill: BaselineSkillCorpusEntry;
  readonly contracts: readonly ToolContractCorpusEntry[];
  readonly schemas: readonly ResponseSchemaCorpusEntry[];
};

export const toolContractBundleFixtures: readonly ToolContractBundleFixture[] =
  [
    bundle(
      "email-triage",
      "inbox-triage",
      ["read-email"],
      ["email-triage-decision"],
    ),
    bundle(
      "calendar-planning",
      "meeting-scheduler",
      ["find-calendar-slots"],
      ["calendar-week-plan"],
    ),
    bundle(
      "invoice-drafting",
      "invoice-drafter",
      ["calculate-invoice"],
      ["invoice-line-items"],
    ),
    bundle(
      "policy-review",
      "policy-summariser",
      ["extract-policy-obligations"],
      ["policy-obligations"],
    ),
  ];

function bundle(
  id: string,
  skillId: string,
  contractIds: readonly string[],
  schemaIds: readonly string[],
): ToolContractBundleFixture {
  const skill = required(
    baselineSkillCorpus.find((entry) => entry.id === skillId),
    skillId,
  );
  return {
    id,
    skill,
    contracts: contractIds.map((entryId) =>
      required(
        toolContractCorpus.find((entry) => entry.id === entryId),
        entryId,
      ),
    ),
    schemas: schemaIds.map((entryId) =>
      required(
        responseSchemaCorpus.find((entry) => entry.id === entryId),
        entryId,
      ),
    ),
  };
}

function required<T>(value: T | undefined, id: string): T {
  if (!value) throw new Error(`Corpus fixture \`${id}\` is missing.`);
  return value;
}
