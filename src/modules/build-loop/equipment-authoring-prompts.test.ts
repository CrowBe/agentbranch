import { describe, expect, it } from "vitest";
import {
  getEquipmentPrimitiveAuthoringPlan,
  renderEquipmentPrimitiveAuthoringPrompt,
} from "./equipment-authoring-prompts";

describe("equipment primitive authoring prompts", () => {
  it("plans response-schema authoring around a concrete example and field rejection rules", () => {
    const plan = getEquipmentPrimitiveAuthoringPlan("response-schema");

    expect(plan.interviewAnchor).toContain("one real filled-in example");
    expect(plan.readinessChecklist).toContain("One concrete valid example.");
    expect(plan.readinessChecklist).toContain("A stated rule for every field.");
    expect(plan.readinessChecklist).toContain("At least one clear reject condition for invalid output.");
    expect(plan.draftingRules).toContain("Draft valid JSON Schema.");
    expect(plan.draftingRules).toContain(
      "Reject only what the user said should be wrong; avoid over-constraining.",
    );
    expect(plan.buildingBlockGuidance).toContain("tool contracts");
  });

  it("plans tool-contract authoring around happy paths, failure modes, and safety boundaries", () => {
    const plan = getEquipmentPrimitiveAuthoringPlan("tool-contract");

    expect(plan.interviewAnchor).toContain("what the tool does in one sentence");
    expect(plan.questions.some((question) => question.includes("failure modes"))).toBe(true);
    expect(plan.readinessChecklist).toContain("One happy-path input/output example.");
    expect(plan.readinessChecklist).toContain("At least one named failure mode.");
    expect(plan.readinessChecklist).toContain(
      "The confirmation boundary for sensitive or external actions.",
    );
    expect(plan.draftingRules).toContain(
      "Reference response schemas by name instead of inlining duplicate shapes.",
    );
  });

  it("renders shared interview rules with approved domain language", () => {
    const prompt = renderEquipmentPrimitiveAuthoringPrompt("response-schema");

    expect(prompt).toContain("Run the interview before the first draft.");
    expect(prompt).toContain('"just draft it"');
    expect(prompt).toContain("building blocks that work together");
    expect(prompt).not.toMatch(/\bcomposable\b/i);
    expect(prompt).not.toMatch(/\bsandbox\b/i);
  });
});

