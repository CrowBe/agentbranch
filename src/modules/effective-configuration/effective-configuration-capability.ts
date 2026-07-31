import {
  defineCapability,
  type Analyzer,
  type Renderer,
} from "@/modules/skill-analysis";
import { ok } from "@/shared";
import { resolveEffectiveConfiguration } from "./resolve-effective-configuration";
import type {
  EffectiveConfigurationGraph,
  EffectiveConfigurationInput,
  EffectiveConfigurationOutline,
} from "./effective-configuration.types";

export const effectiveConfigurationAnalyzer:
  Analyzer<EffectiveConfigurationInput, EffectiveConfigurationGraph> = {
    kind: "effective-configuration-graph",
    async analyze(input) {
      return ok(resolveEffectiveConfiguration(input));
    },
  };

export const effectiveConfigurationOutlineRenderer:
  Renderer<EffectiveConfigurationGraph, EffectiveConfigurationOutline> = {
    target: "outline",
    render(graph) {
      const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
      return {
        title: "Effective configuration",
        instructionOrder: graph.effective.instructions.map((id, index) => {
          const node = nodeById.get(id)!;
          return {
            nodeId: id,
            position: index + 1,
            label: node.label,
            source: node.evidence.path,
          };
        }),
        rows: graph.nodes.map((node) => ({
          nodeId: node.id,
          component: node.label,
          kind: node.kind,
          status: node.effective ? "effective" : "shadowed",
          source: node.evidence.path,
          adapterRule: node.evidence.adapterRule,
          confidence: node.evidence.confidence,
        })),
        relationships: graph.edges.map((edge) => ({
          id: edge.id,
          relationship: edge.kind,
          source: nodeById.get(edge.from)?.label ?? edge.from,
          target: edge.to ? nodeById.get(edge.to)?.label ?? edge.target : edge.target,
          status: edge.status,
        })),
        findings: graph.findings.map((finding) => ({
          code: finding.code,
          message: finding.message,
          source: finding.evidence.path,
        })),
      };
    },
  };

export const effectiveConfigurationCapability = defineCapability({
  name: "Effective configuration",
  analyzer: effectiveConfigurationAnalyzer,
  renderers: { outline: effectiveConfigurationOutlineRenderer },
});
