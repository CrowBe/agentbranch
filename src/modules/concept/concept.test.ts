import { describe, expect, it } from "vitest";
import { conceptLibrary } from "@/modules/concept-library";
import { runCapability } from "@/modules/skill-analysis";
import { unwrap } from "@/shared";
import { conceptCapability } from ".";

describe("concept capability", () => {
  it("is a pure analysis capability that renders the reviewed kernel", async () => {
    const concept = conceptLibrary.find(
      (candidate) => candidate.id === "equipment-primitive-decision",
    )!;
    const rendered = unwrap(
      await runCapability(conceptCapability, "rendered", concept),
    );

    expect(conceptCapability.mode).toBe("analysis");
    expect(rendered).toMatchObject({
      id: "equipment-primitive-decision",
      title: "Which primitive do I need?",
      kind: "decision-aid",
    });
    expect(rendered.options).toHaveLength(4);
    expect(rendered.idea.citations).not.toHaveLength(0);
    expect(rendered.terms).toEqual([
      "Skill",
      "Response schema",
      "Tool contract",
      "Subagent definition",
    ]);
  });
});
