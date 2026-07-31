import { createHash } from "node:crypto";
import type {
  AgentComponent,
  AgentConfigurationSnapshot,
  SourceFile,
  SourceSpan,
} from "@/modules/agent-configuration";
import type {
  EffectiveConfigurationEdge,
  EffectiveConfigurationEvidence,
  EffectiveConfigurationFinding,
  EffectiveConfigurationGraph,
  EffectiveConfigurationInput,
  EffectiveConfigurationNode,
  EffectiveConfigurationResolutionRule,
} from "./effective-configuration.types";

const compareText = (a: string, b: string) => a.localeCompare(b);

function wholeFileSpan(file: SourceFile): SourceSpan {
  if (file.encoding === "base64") {
    return { startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 };
  }
  const lines = file.content.split("\n");
  return {
    startLine: 1,
    startColumn: 1,
    endLine: lines.length,
    endColumn: (lines.at(-1)?.length ?? 0) + 1,
  };
}

function stableId(prefix: string, value: string): string {
  return `${prefix}-${createHash("sha256").update(value).digest("hex").slice(0, 16)}`;
}

function validSourceSpan(file: SourceFile, span: SourceSpan): boolean {
  if (
    span.startLine < 1
    || span.startColumn < 1
    || span.endLine < span.startLine
    || (span.endLine === span.startLine && span.endColumn < span.startColumn)
  ) return false;
  if (file.encoding === "base64") {
    return span.startLine === 1 && span.startColumn === 1
      && span.endLine === 1 && span.endColumn === 1;
  }
  const lines = file.content.split("\n");
  return span.startLine <= lines.length
    && span.endLine <= lines.length
    && span.startColumn <= lines[span.startLine - 1]!.length + 1
    && span.endColumn <= lines[span.endLine - 1]!.length + 1;
}

function evidenceFor(
  snapshot: AgentConfigurationSnapshot,
  component: AgentComponent,
  rule?: EffectiveConfigurationResolutionRule,
): EffectiveConfigurationEvidence {
  const file = snapshot.files.find((item) => item.path === component.path)!;
  return {
    path: component.path,
    span: component.span ?? wholeFileSpan(file),
    adapterRule:
      rule?.adapterRule
      ?? component.importProvenance?.rule
      ?? "snapshot.component",
    confidence: rule ? "certain" : "ambiguous",
  };
}

function componentLabel(component: AgentComponent, rule?: EffectiveConfigurationResolutionRule) {
  return rule?.label ?? rule?.declaration ?? component.path;
}

function graphNodeId(componentId: string): string {
  return `component:${componentId}`;
}

function precedenceGroups(
  components: readonly AgentComponent[],
  rules: ReadonlyMap<string, EffectiveConfigurationResolutionRule>,
) {
  const groups = new Map<string, AgentComponent[]>();
  for (const component of components) {
    const declaration = rules.get(component.id)?.declaration;
    if (!declaration) continue;
    const key = `${component.kind}\0${declaration}`;
    groups.set(key, [...(groups.get(key) ?? []), component]);
  }
  return groups;
}

export function resolveEffectiveConfiguration(
  input: EffectiveConfigurationInput,
): EffectiveConfigurationGraph {
  const components = [...input.snapshot.components].sort((a, b) =>
    `${a.path}\0${a.kind}\0${a.id}`.localeCompare(`${b.path}\0${b.kind}\0${b.id}`),
  );
  const ruleByComponent = new Map(input.rules.map((rule) => [rule.componentId, rule]));
  const effective = new Map(components.map((component) => [component.id, true]));
  const edges: EffectiveConfigurationEdge[] = [];
  const findings: EffectiveConfigurationFinding[] = [];

  for (const [key, group] of precedenceGroups(components, ruleByComponent)) {
    if (group.length < 2) continue;
    const ordered = [...group].sort((a, b) => {
      const delta =
        (ruleByComponent.get(b.id)?.precedence ?? 0)
        - (ruleByComponent.get(a.id)?.precedence ?? 0);
      return delta || compareText(a.id, b.id);
    });
    const highest = ruleByComponent.get(ordered[0]!.id)?.precedence ?? 0;
    const winners = ordered.filter(
      (component) => (ruleByComponent.get(component.id)?.precedence ?? 0) === highest,
    );
    const firstEvidence = evidenceFor(
      input.snapshot,
      ordered[0]!,
      ruleByComponent.get(ordered[0]!.id),
    );
    findings.push({
      code: "duplicate-declaration",
      message: `Multiple components declare ${key.split("\0")[1]}.`,
      nodeIds: ordered.map((item) => graphNodeId(item.id)),
      evidence: firstEvidence,
    });
    if (winners.length > 1) {
      findings.push({
        code: "ambiguous-precedence",
        message: `Precedence is ambiguous for ${key.split("\0")[1]}; all tied declarations remain explicit.`,
        nodeIds: winners.map((item) => graphNodeId(item.id)),
        evidence: { ...firstEvidence, confidence: "ambiguous" },
      });
      for (const winner of winners) {
        for (const peer of winners) {
          if (winner.id >= peer.id) continue;
          const evidence = evidenceFor(
            input.snapshot,
            winner,
            ruleByComponent.get(winner.id),
          );
          edges.push({
            id: stableId("edge", `overrides\0${winner.id}\0${peer.id}`),
            kind: "overrides",
            from: graphNodeId(winner.id),
            target: graphNodeId(peer.id),
            status: "ambiguous",
            evidence: { ...evidence, confidence: "ambiguous" },
          });
        }
      }
      continue;
    }

    const winner = winners[0]!;
    for (const shadowed of ordered.slice(1)) {
      effective.set(shadowed.id, false);
      const evidence = evidenceFor(input.snapshot, winner, ruleByComponent.get(winner.id));
      edges.push({
        id: stableId("edge", `overrides\0${winner.id}\0${shadowed.id}`),
        kind: "overrides",
        from: graphNodeId(winner.id),
        to: graphNodeId(shadowed.id),
        target: graphNodeId(shadowed.id),
        status: "resolved",
        evidence,
      });
      if (shadowed.kind === "instruction") {
        findings.push({
          code: "shadowed-instruction",
          message: `${componentLabel(shadowed, ruleByComponent.get(shadowed.id))} is shadowed by ${componentLabel(winner, ruleByComponent.get(winner.id))}.`,
          nodeIds: [graphNodeId(shadowed.id), graphNodeId(winner.id)],
          evidence: evidenceFor(
            input.snapshot,
            shadowed,
            ruleByComponent.get(shadowed.id),
          ),
        });
      }
    }
  }

  const instructionIds = components
    .filter((component) => component.kind === "instruction" && effective.get(component.id))
    .sort((a, b) => {
      const delta =
        (ruleByComponent.get(a.id)?.instructionOrder ?? Number.MAX_SAFE_INTEGER)
        - (ruleByComponent.get(b.id)?.instructionOrder ?? Number.MAX_SAFE_INTEGER);
      return delta || compareText(a.path, b.path) || compareText(a.id, b.id);
    })
    .map((component) => component.id);
  const instructionOrder = new Map(instructionIds.map((id, index) => [id, index + 1]));

  const nodes: EffectiveConfigurationNode[] = components.map((component) => {
    const rule = ruleByComponent.get(component.id);
    return {
      id: graphNodeId(component.id),
      componentId: component.id,
      kind: component.kind,
      label: componentLabel(component, rule),
      effective: effective.get(component.id) ?? true,
      ...(instructionOrder.has(component.id)
        ? { order: instructionOrder.get(component.id) }
        : {}),
      evidence: evidenceFor(input.snapshot, component, rule),
    };
  });

  const targets = new Map<string, EffectiveConfigurationNode[]>();
  for (const node of nodes) {
    const rule = ruleByComponent.get(node.componentId);
    for (const key of [
      node.componentId,
      node.id,
      node.evidence.path,
      node.label,
      ...(rule?.declaration ? [rule.declaration] : []),
    ]) {
      const existing = targets.get(key) ?? [];
      if (!existing.some((candidate) => candidate.id === node.id)) {
        targets.set(key, [...existing, node]);
      }
    }
  }

  for (const component of components) {
    const rule = ruleByComponent.get(component.id);
    for (const [occurrence, relationship] of (rule?.relationships ?? []).entries()) {
      const source = input.snapshot.files.find((file) => file.path === component.path)!;
      if (relationship.span && !validSourceSpan(source, relationship.span)) {
        throw new Error(
          `Component ${component.id} relationship ${occurrence + 1} has an invalid source span.`,
        );
      }
      const matches = targets.get(relationship.target) ?? [];
      const status = matches.length === 1
        ? "resolved"
        : matches.length === 0
          ? "unresolved"
          : "ambiguous";
      const baseEvidence = evidenceFor(input.snapshot, component, rule);
      const evidence = {
        ...baseEvidence,
        ...(relationship.span ? { span: relationship.span } : {}),
        confidence: status === "resolved" ? relationship.confidence : "ambiguous" as const,
      };
      const edge: EffectiveConfigurationEdge = {
        id: stableId(
          "edge",
          `${relationship.kind}\0${component.id}\0${relationship.target}\0${status}\0${occurrence}`,
        ),
        kind: relationship.kind,
        from: graphNodeId(component.id),
        ...(matches.length === 1 ? { to: matches[0]!.id } : {}),
        target: relationship.target,
        status,
        evidence,
      };
      edges.push(edge);
      if (status === "unresolved") {
        findings.push({
          code: "unresolved-reference",
          message: `${nodeLabel(nodes, edge.from)} ${relationship.kind} unresolved target ${relationship.target}.`,
          nodeIds: [edge.from],
          evidence,
        });
      } else if (status === "ambiguous") {
        findings.push({
          code: "ambiguous-relationship",
          message: `${nodeLabel(nodes, edge.from)} has an ambiguous ${relationship.kind} target ${relationship.target}.`,
          nodeIds: [edge.from, ...matches.map((match) => match.id)],
          evidence,
        });
      }
    }
  }

  const roots = new Set(input.rules
    .filter((rule) => rule.root && effective.get(rule.componentId))
    .map((rule) => graphNodeId(rule.componentId)));
  const effectiveNodeIds = new Set(nodes.filter((node) => node.effective).map((node) => node.id));
  const reachable = new Set(roots);
  const pending = [...roots];
  while (pending.length > 0) {
    const current = pending.shift()!;
    if (!effectiveNodeIds.has(current)) continue;
    for (const edge of edges) {
      if (edge.status !== "resolved" || edge.from !== current || !edge.to) continue;
      if (!reachable.has(edge.to)) {
        reachable.add(edge.to);
        pending.push(edge.to);
      }
    }
  }
  for (const node of nodes) {
    if (!node.effective || reachable.has(node.id)) continue;
    findings.push({
      code: "unreachable-component",
      message: `${node.label} is not reachable from an effective root or relationship.`,
      nodeIds: [node.id],
      evidence: node.evidence,
    });
  }

  const nodeIds = (kind: AgentComponent["kind"]) =>
    nodes.filter((node) => node.kind === kind && node.effective).map((node) => node.id);
  return {
    kind: "effective-configuration-graph",
    nodes,
    edges: edges.sort((a, b) => compareText(a.id, b.id)),
    findings: findings.sort((a, b) =>
      `${a.code}\0${a.evidence.path}\0${a.message}`.localeCompare(
        `${b.code}\0${b.evidence.path}\0${b.message}`,
      ),
    ),
    effective: {
      instructions: instructionIds.map(graphNodeId),
      skills: nodeIds("skill"),
      tools: nodeIds("tool"),
      modelSettings: nodeIds("model"),
      policies: nodeIds("policy"),
    },
  };
}

function nodeLabel(nodes: readonly EffectiveConfigurationNode[], id: string): string {
  return nodes.find((node) => node.id === id)?.label ?? id;
}
