import { describe, expect, it } from "vitest";
import { taskOutcomeCorpus, taskOutcomeCorpusSetHash } from "./index";

describe("task outcome corpus", () => {
  it("pins independently hashed entries and the frozen set", () => {
    expect(Object.fromEntries(taskOutcomeCorpus.map((entry) => [entry.id, entry.contentHash]))).toEqual({
      "overdue-invoice-follow-up": "561615b0d1231d841bf4a4413a75a088e862883ace5affcaf3bbc12125d72dcd",
      "appointment-request-triage": "8d6e38a414aac6fc7ee9cb32ac0e829900a6d693e3329ef4fa6f4d3a3087ab50",
      "inventory-reorder-decision": "9bd5f79e563fcbbfba2ab4cae9faf06f90eb6bdbf3228aad55d667c541bde9f1",
      "weekly-cash-snapshot": "701dc0a78955e8c340dd34c8b1d48d2700f5b7c7e50135d790cf043784658739",
    });
    expect(taskOutcomeCorpusSetHash).toBe("516284a87b45fe59d029bc38a51dbd805c2d4121c35ac080e38a9644cdb7d65c");
  });

  it("carries frozen JSON expectations and complete provenance", () => {
    expect(taskOutcomeCorpus).toHaveLength(4);
    for (const entry of taskOutcomeCorpus) {
      expect(entry.case.grader).toBe("json-output");
      expect(entry.case.graderVersion).toBe(1);
      expect(entry.case.expectedSchema).toMatchObject({ type: "object", additionalProperties: false });
      expect(entry.provenance).toEqual({
        authoringTool: expect.any(String),
        authoredAt: "2026-07-26",
        sourcePrompt: expect.any(String),
      });
      expect(entry.contentHash).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});
