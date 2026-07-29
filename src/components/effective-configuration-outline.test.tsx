import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { EffectiveConfigurationOutline as Outline } from "@/modules/effective-configuration";
import { EffectiveConfigurationOutline } from "./effective-configuration-outline";

const outline: Outline = {
  title: "Effective configuration",
  instructionOrder: [{
    nodeId: "component:instructions",
    position: 1,
    label: "Project instructions",
    source: "AGENTS.md",
  }],
  rows: [{
    nodeId: "component:instructions",
    component: "Project instructions",
    kind: "instruction",
    status: "effective",
    source: "AGENTS.md",
    adapterRule: "codex.instructions",
    confidence: "certain",
  }],
  relationships: [{
    id: "edge:reference",
    relationship: "references",
    source: "Project instructions",
    target: "missing.md",
    status: "unresolved",
  }],
  findings: [{
    code: "unresolved-reference",
    message: "Project instructions references unresolved target missing.md.",
    source: "AGENTS.md",
  }],
};

describe("EffectiveConfigurationOutline", () => {
  it("renders the graph as a semantic outline and scoped tables", () => {
    const { container } = render(<EffectiveConfigurationOutline outline={outline} />);

    expect(screen.getByRole("heading", { name: "Effective configuration" })).toBeVisible();
    expect(screen.getAllByRole("list")[0]).toHaveTextContent("Project instructions");
    const componentTable = screen.getByRole("table", {
      name: "Components and source provenance",
    });
    expect(within(componentTable).getByRole("columnheader", { name: "Adapter rule" }))
      .toHaveAttribute("scope", "col");
    expect(within(componentTable).getByRole("rowheader", { name: "Project instructions" }))
      .toHaveAttribute("scope", "row");
    expect(screen.getByRole("table", {
      name: "Source-backed component relationships",
    })).toHaveTextContent("unresolved");
    expect(container.querySelector("canvas")).toBeNull();
  });
});
