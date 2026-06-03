import { describe, it, expect } from "vitest";
import {
  defineCapability,
  defineEvaluation,
  runCapability,
  runEvaluation,
} from "./seam";
import type { Artifact, Analyzer, Evaluator, Renderer } from "./seam.types";
import type { ModelGateway } from "@/modules/model-gateway";
import { makeSkill, parseSkillMd, type Skill } from "@/modules/skill";
import { ok, err, domainError, isErr, unwrap, SkillId, UserId } from "@/shared";

/** A fake gateway. `hasModel` toggles the offline guard; `classify` is canned. */
function fakeGateway(hasModel: boolean): ModelGateway {
  return {
    hasModel,
    async classify(input) {
      if (!hasModel) return err(domainError("model_unavailable", "offline"));
      // Trivial probe: "fire" if the candidate is among the choices.
      const choice = input.choices.includes("fire") ? "fire" : null;
      return ok({ choice, rationale: "probe" });
    },
    async runAgent() {
      if (!hasModel) return err(domainError("model_unavailable", "offline"));
      return ok({ transcript: [] });
    },
    async generate({ schema }) {
      if (!hasModel) return err(domainError("model_unavailable", "offline"));
      return ok(schema.parse({}));
    },
  };
}

/** Minimal probe artifact for the analysis side — "hero" is an analysis kind. */
type WordCount = Artifact<"hero"> & { readonly count: number };

/** Minimal probe artifact for the evaluation side. */
type Verdict = Artifact<"triggering-eval"> & { readonly fired: boolean };

function fixtureSkill(): Skill {
  const source = unwrap(
    parseSkillMd(`---\nname: t\ndescription: d\n---\nalpha beta gamma`),
  );
  return makeSkill({
    id: SkillId("s1"),
    userId: UserId("u1"),
    source,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  });
}

const analyzer: Analyzer<WordCount> = {
  kind: "hero",
  async analyze(skill) {
    return ok({ kind: "hero", count: skill.source.body.split(/\s+/).length });
  },
};

const countText: Renderer<WordCount, string> = {
  target: "text",
  render: (a) => `${a.count} words`,
};

const evaluator: Evaluator<Verdict> = {
  kind: "triggering-eval",
  // Owns its method: builds its own conditions (the "fire" choice) and composes
  // the verdict from the gateway's `classify` primitive. Resource handed in
  // (the gateway), method owned (what to classify, how to read the result).
  async evaluate(_skill, gateway) {
    const c = await gateway.classify({
      prompt: "summarise my inbox",
      choices: ["fire", "other-skill"],
      tag: { kind: "platform", reason: "probe" },
    });
    if (isErr(c)) return c;
    return ok({ kind: "triggering-eval", fired: c.value.choice === "fire" });
  },
};

const verdictInsights: Renderer<Verdict, string> = {
  target: "insights",
  render: (a) => (a.fired ? "Fires on the right prompt" : "Stayed silent"),
};

describe("the seam — analysis", () => {
  it("runs analyze → render through one pipeline", async () => {
    const cap = defineCapability({
      name: "word-count",
      analyzer,
      renderers: { text: countText },
    });
    const result = await runCapability(cap, "text", fixtureSkill());
    expect(unwrap(result)).toBe("3 words");
  });

  it("is tagged as an analysis capability", () => {
    const cap = defineCapability({
      name: "word-count",
      analyzer,
      renderers: { text: countText },
    });
    expect(cap.mode).toBe("analysis");
  });
});

describe("the seam — evaluation", () => {
  const cap = defineEvaluation({
    name: "did-it-fire",
    evaluator,
    renderers: { insights: verdictInsights },
  });

  it("is tagged as an evaluation capability", () => {
    expect(cap.mode).toBe("evaluation");
  });

  it("runs evaluate → render when a model is available", async () => {
    const result = await runEvaluation(cap, "insights", fixtureSkill(), fakeGateway(true));
    expect(unwrap(result)).toBe("Fires on the right prompt");
  });

  it("fails model_unavailable offline — guarded once in the seam", async () => {
    const result = await runEvaluation(cap, "insights", fixtureSkill(), fakeGateway(false));
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.tag).toBe("model_unavailable");
  });
});
