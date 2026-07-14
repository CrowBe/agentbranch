import { describe, it, expect } from "vitest";
import { visualiseCapability } from "./index";
import { irAnalyzer } from "./extract-ir";
import { runCapability } from "@/modules/skill-analysis";
import { makeSkill, parseSkillMd, type Skill } from "@/modules/skill";
import type { ModelGateway } from "@/modules/model-gateway";
import { ok, unwrap, SkillId, UserId } from "@/shared";

function fixtureSkill(): Skill {
  const source = unwrap(
    parseSkillMd(
      `---\nname: t\ndescription: d\n---\n# Fetch mail\n# Never auto-send\n# Summarise`,
    ),
  );
  return makeSkill({
    id: SkillId("s1"),
    userId: UserId("u1"),
    source,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  });
}

describe("visualise capability", () => {
  it("renders a Mermaid flowchart with start/end and a constraint node", async () => {
    const out = unwrap(await runCapability(visualiseCapability, "mermaid", fixtureSkill()));
    expect(out.mermaid).toMatch(/^flowchart TD/);
    expect(out.mermaid).toContain("([Triggered])");
    expect(out.mermaid).toContain("([Done])");
    // constraint nodes use the /.../ shape
    expect(out.mermaid).toContain("[/Never auto-send/]");
    expect(out.mermaid).toContain("-->");
  });

  it("uses a gateway-generated IR when model context is supplied", async () => {
    const out = unwrap(
      await runCapability(visualiseCapability, "mermaid", fixtureSkill(), {
        gateway: fakeGateway(),
        tag: { kind: "account", userId: UserId("u1"), capability: "visualise" },
      }),
    );

    expect(out.mermaid).toMatch(/^stateDiagram-v2/);
    expect(out.mermaid).toContain("branch: Decide whether to reply");
  });

  it("falls back to deterministic IR without a model", async () => {
    const ir = unwrap(await irAnalyzer.analyze(fixtureSkill(), { gateway: offlineGateway() }));
    expect(ir.diagram).toBe("flowchart");
    expect(ir.nodes.map((node) => node.label)).toContain("Fetch mail");
  });

  it("never emits Mermaid-reserved identifiers as node ids", async () => {
    // `end` is Mermaid syntax (closes a subgraph / composite state); an IR
    // node with that id must serialize suffixed or the whole diagram fails to
    // parse — in the flowchart fallback and the model-emitted state diagram.
    const flowchart = unwrap(await runCapability(visualiseCapability, "mermaid", fixtureSkill()));
    expect(flowchart.mermaid).toContain("end_([Done])");
    expect(flowchart.mermaid).toContain("--> end_");
    expect(flowchart.mermaid).not.toMatch(/^\s*end\(/m);

    const state = unwrap(
      await runCapability(visualiseCapability, "mermaid", fixtureSkill(), {
        gateway: fakeGateway(),
        tag: { kind: "account", userId: UserId("u1"), capability: "visualise" },
      }),
    );
    expect(state.mermaid).toContain("end_: Done");
    expect(state.mermaid).not.toMatch(/^\s*end:/m);
  });
});

function fakeGateway(): ModelGateway {
  return {
    hasModel: true,
    async classify() {
      return ok({ choice: null, rationale: "n/a" });
    },
    async runAgent() {
      return ok({ transcript: [] });
    },
    async streamAgent() {
      async function* empty() {}
      return ok(empty());
    },
    async generate({ schema }) {
      return ok(
        schema.parse({
          kind: "skill-ir",
          diagram: "stateDiagram",
          nodes: [
            { id: "start", label: "Triggered", kind: "start", span: { start: 0, end: 0 } },
            {
              id: "branch",
              label: "Decide whether to reply",
              kind: "decision",
              span: { start: 13, end: 30 },
            },
            { id: "end", label: "Done", kind: "end", span: { start: 0, end: 0 } },
          ],
          edges: [
            { from: "start", to: "branch" },
            { from: "branch", to: "end", label: "ready" },
          ],
        }),
      );
    },
  };
}

function offlineGateway(): ModelGateway {
  return { ...fakeGateway(), hasModel: false };
}
