const TRACE_SCHEMA_VERSION = "agentbranch.provider-neutral-trace.v1";
const SENSITIVE_KEY =
  /(?:^|[_-])(?:api[_-]?key|secret|password|credential|private[_-]?key|(?:access|refresh|auth)[_-]?token|token|authorization|process[_-]?environment|environment|env)(?:$|[_-])/iu;

/**
 * Removable PoC adapter around the model gateway's stable AgentTurn transcript.
 * Keep this shape structurally aligned with AgentStep in
 * src/modules/model-gateway/gateway.types.ts without importing production code.
 */
export function mapAgentTurnToTrace(turn) {
  if (!turn || !Array.isArray(turn.transcript)) {
    throw new TypeError("AgentTurn.transcript must be an array.");
  }

  return {
    schema_version: TRACE_SCHEMA_VERSION,
    source_seam: {
      module: "model-gateway",
      contract: "AgentTurn.transcript",
      adapter: "smevals-poc/v1",
    },
    steps: turn.transcript.map(copyAgentStep),
  };
}

export function executionArtifactsFromTrace(trace) {
  const toolCalls = [];
  const pendingByTool = new Map();
  for (const [index, step] of trace.steps.entries()) {
    if (step.kind === "tool-call") {
      const pending = pendingByTool.get(step.tool) ?? [];
      pending.push({ index, tool: step.tool, input: step.input });
      pendingByTool.set(step.tool, pending);
      continue;
    }
    if (step.kind !== "tool-result") continue;
    const pending = pendingByTool.get(step.tool) ?? [];
    const call = pending.shift();
    if (!call) continue;
    toolCalls.push({
      ...call,
      output: step.output,
      status: isFailureOutput(step.output) ? "failed" : "completed",
    });
  }

  const recoveries = [];
  const failuresByTool = new Map();
  for (const [index, call] of toolCalls.entries()) {
    if (call.status === "failed") {
      failuresByTool.set(call.tool, (failuresByTool.get(call.tool) ?? 0) + 1);
      continue;
    }
    const failedCalls = failuresByTool.get(call.tool) ?? 0;
    if (failedCalls > 0) {
      recoveries.push({
        tool: call.tool,
        failed_calls: failedCalls,
        recovered_by_call: index + 1,
      });
      failuresByTool.set(call.tool, 0);
    }
  }

  return {
    schema_version: "agentbranch.execution-artifacts.v1",
    tool_calls: toolCalls,
    delegations: toolCalls
      .filter((call) => call.tool === "delegate")
      .map((call) => ({
        target: call.input?.to ?? null,
        status: call.status,
        output: call.output,
      })),
    recoveries,
  };
}

function isFailureOutput(output) {
  return Boolean(output && typeof output === "object" && "error" in output && output.error);
}

/**
 * Resolve the repository-owned PoC definition into an allowlisted, credential-
 * free agent configuration. Unknown fields are deliberately not copied, so an
 * environment object or provider credential cannot cross the artifact seam.
 */
export function credentialFreeAgentConfiguration(input) {
  if (!input || typeof input !== "object") {
    throw new TypeError("agent_configuration must be an object.");
  }

  return {
    schema_version: "agentbranch.resolved-agent-configuration.v1",
    id: requiredString(input.id, "agent_configuration.id"),
    runtime_adapter: copyFields(input.runtime_adapter, ["id", "version"], "runtime_adapter"),
    model: {
      ...copyFields(input.model, ["provider", "id"], "model"),
      parameters: credentialFreeValue(input.model?.parameters ?? {}),
    },
    instructions: copyList(input.instructions, ["id", "content", "source"], "instructions"),
    skills: copyList(input.skills, ["name", "source"], "skills"),
    subagents: copyList(input.subagents, ["name", "source"], "subagents"),
    tools: copyList(input.tools, ["name", "description", "source"], "tools"),
    policies: copyList(input.policies, ["id", "rule", "source"], "policies"),
    secret_requirements: copyList(
      input.secret_requirements,
      ["name", "purpose"],
      "secret_requirements",
    ),
  };
}

function copyList(value, fields, label) {
  if (!Array.isArray(value)) throw new TypeError(`agent_configuration.${label} must be an array.`);
  return value.map((entry, index) => copyFields(entry, fields, `${label}[${index}]`));
}

function copyFields(value, fields, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`agent_configuration.${label} must be an object.`);
  }
  const copied = {};
  for (const field of fields) {
    if (value[field] !== undefined) copied[field] = credentialFreeValue(value[field]);
  }
  return copied;
}

function credentialFreeValue(value) {
  if (value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(credentialFreeValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !SENSITIVE_KEY.test(key))
        .map(([key, nested]) => [key, credentialFreeValue(nested)]),
    );
  }
  if (["string", "number", "boolean"].includes(typeof value) || value === null) return value;
  throw new TypeError(`Unsupported agent configuration value: ${typeof value}`);
}

function requiredString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value;
}

function copyAgentStep(step) {
  if (!step || typeof step !== "object") {
    throw new TypeError("AgentTurn transcript steps must be objects.");
  }
  if (step.kind === "model" && typeof step.text === "string") {
    return { kind: "model", text: step.text };
  }
  if (step.kind === "tool-call" && typeof step.tool === "string") {
    return { kind: "tool-call", tool: step.tool, input: credentialFreeValue(step.input ?? null) };
  }
  if (step.kind === "tool-result" && typeof step.tool === "string") {
    return { kind: "tool-result", tool: step.tool, output: credentialFreeValue(step.output ?? null) };
  }
  throw new TypeError(`Unsupported AgentTurn transcript step: ${JSON.stringify(step)}`);
}
