import { describe, expect, it } from "vitest";
import type { GenerateInput, ModelGateway } from "@/modules/model-gateway";
import { makeSkill, parseSkillMd, type Skill } from "@/modules/skill";
import { domainError, err, ok, SkillId, UserId, unwrap } from "@/shared";
import { runCrossRuntimeValidation } from "./portability-transform";
import type { RuntimeTarget, RuntimeTargetResult } from "./portability.types";

function skillFor(description: string): Skill {
  const source = unwrap(parseSkillMd(`---\nname: calendar\ndescription: ${description}\n---\nbody`));
  return makeSkill({
    id: SkillId("s1"),
    userId: UserId("u1"),
    source,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  });
}

function fakeGateway(options: {
  readonly unavailableProviderIds?: readonly string[];
  readonly generateCalls?: GenerateInput<unknown>[];
} = {}): ModelGateway {
  return {
    hasModel: true,
    async classify({ prompt, choices, target }) {
      if (options.unavailableProviderIds?.includes(target?.providerId ?? "")) {
        return err(domainError("model_unavailable", "No API key for target."));
      }
      const candidate = choices[0] ?? "";
      const fires = prompt.toLowerCase().includes("calendar") || prompt.toLowerCase().includes("schedule");
      return ok({ choice: fires ? candidate : null, rationale: target?.providerId ?? "default" });
    },
    async streamAgent() {
      async function* empty() {}
      return ok(empty());
    },
    async runAgent() {
      return ok({ transcript: [] });
    },
    async generate(input) {
      options.generateCalls?.push(input as GenerateInput<unknown>);
      if (input.prompt.includes("Return 3 positive prompts and 3 negative prompts.")) {
        return ok(
          input.schema.parse({
            positive: ["Schedule a calendar meeting.", "Move my calendar block."],
            negative: ["Summarize this report.", "Translate this note."],
          }),
        );
      }
      return ok(
        input.schema.parse({
          verdict: "good",
          summary: "Runtime targets behave consistently.",
          findings: ["stable trigger behaviour"],
          watch: [],
        }),
      );
    },
  };
}

const claudeTarget: RuntimeTarget = {
  id: "home-claude",
  label: "Home Claude baseline",
  modelSelection: { providerId: "anthropic" },
};

const codexTarget: RuntimeTarget = {
  id: "openai-codex",
  label: "OpenAI / Codex-class",
  modelSelection: { providerId: "nous" },
};

describe("cross-runtime validation", () => {
  it("runs the triggering battery against each configured target", async () => {
    const generateCalls: GenerateInput<unknown>[] = [];
    const result = unwrap(
      await runCrossRuntimeValidation(
        { skill: skillFor("Schedule meetings on the calendar."), targets: [claudeTarget, codexTarget] },
        fakeGateway({ generateCalls }),
      ),
    );

    expect(result.kind).toBe("cross-runtime-validation");
    expect(result.targets.map((target) => target.label)).toEqual([
      "Home Claude baseline",
      "OpenAI / Codex-class",
    ]);
    expect(result.targets.every((target) => target.status === "passed")).toBe(true);
    expect(
      generateCalls.filter((call) =>
        call.prompt.includes("Return 3 positive prompts and 3 negative prompts."),
      ),
    ).toHaveLength(1);
    const passedTargets = result.targets.filter(hasCases);
    const prompts = passedTargets[0]?.cases.map((c) => c.prompt).join("\0");
    expect(passedTargets.every((target) => target.cases.map((c) => c.prompt).join("\0") === prompts)).toBe(true);
    expect(JSON.stringify(result.targets)).not.toContain("claude-opus");
    expect(JSON.stringify(result.targets)).not.toContain("Hermes");
    expect(generateCalls.some((call) => call.target?.providerId === "nous")).toBe(true);
  });

  it("marks an unconfigured target without failing configured targets", async () => {
    const result = unwrap(
      await runCrossRuntimeValidation(
        { skill: skillFor("Schedule meetings on the calendar."), targets: [claudeTarget, codexTarget] },
        fakeGateway({ unavailableProviderIds: ["nous"] }),
      ),
    );

    expect(result.targets).toMatchObject([
      { targetId: "home-claude", status: "passed" },
      { targetId: "openai-codex", status: "not_configured" },
    ]);
    expect(result.insight.summary).toBe("Runtime targets behave consistently.");
  });
});

function hasCases(
  target: RuntimeTargetResult,
): target is Extract<RuntimeTargetResult, { readonly status: "passed" | "failed" }> {
  return target.status === "passed" || target.status === "failed";
}
