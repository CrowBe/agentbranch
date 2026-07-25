import { describe, expect, it } from "vitest";
import { taskOutcomeCorpus, taskOutcomeCorpusSetHash } from "./index";

describe("task outcome corpus", () => {
  it("pins independently hashed entries and the frozen set", () => {
    expect(Object.fromEntries(taskOutcomeCorpus.map((entry) => [entry.id, entry.contentHash]))).toEqual({
      "overdue-invoice-follow-up": "a8967e8b45cc5bbdd2432e0770d21eca98923ab0b1b989165be4155ab7bb9862",
      "appointment-request-triage": "f26624d2615b530e9c060dbb03a48e3d388e69ddfa1b7860c6cb7bd4aa81b087",
      "inventory-reorder-decision": "124762295699c37fe93a45af7cb0423824f35561d250c3d48431e82d0923153e",
      "weekly-cash-snapshot": "4592ebaf20587fe895da5df347775f735c620e26f413d39a9e4e422d389bb28b",
    });
    expect(taskOutcomeCorpusSetHash).toBe("3091d9cb510f7ae922aad908942ee901764ecfd4a6bb98cec8adde36f49d1fae");
  });

  it("carries frozen JSON expectations and complete provenance", () => {
    expect(taskOutcomeCorpus).toHaveLength(4);
    for (const entry of taskOutcomeCorpus) {
      expect(entry.case.grader).toBe("json-output");
      expect(entry.case.graderVersion).toBe(1);
      expect(entry.case.expectedSchema).toMatchObject({ type: "object", additionalProperties: false });
      expect(Object.values(
        (entry.case.expectedSchema.properties ?? {}) as Record<string, Record<string, unknown>>,
      ).every((property) => Object.hasOwn(property, "const"))).toBe(true);
      expect(entry.provenance).toEqual({
        authoringTool: expect.any(String),
        authoredAt: "2026-07-26",
        sourcePrompt: expect.any(String),
      });
      expect(entry.contentHash).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});
