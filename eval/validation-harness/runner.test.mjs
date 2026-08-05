import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  credentialFreeAgentConfiguration,
  executionArtifactsFromTrace,
  mapAgentTurnToTrace,
} from "./runner-contract.mjs";

const RUNNER = join(import.meta.dirname, "run-agentbranch");

function readJson(runDir, name) {
  return JSON.parse(readFileSync(join(runDir, name), "utf8"));
}

function runScenario(task, extra = {}) {
  const root = mkdtempSync(join(tmpdir(), "agentbranch-runner-"));
  const runDir = join(root, task, "default", "agentbranch-default-config", "2026-08-05T00-00-00");
  mkdirSync(runDir, { recursive: true });
  const result = spawnSync(RUNNER, {
    encoding: "utf8",
    env: {
      ...process.env,
      SMEVALS_RUN_DIR: runDir,
      SMEVALS_MODEL: "agentbranch/default-config",
      SMEVALS_TASK: task,
      SMEVALS_PROMPT: "Run the repository-owned case.",
      SMEVALS_TASK_SCENARIO: task,
      ...extra,
    },
  });
  return { root, runDir, result };
}

test("maps the model-gateway AgentTurn transcript to the provider-neutral trace contract", () => {
  const trace = mapAgentTurnToTrace({
    transcript: [
      { kind: "model", text: "I will inspect the inbox." },
      {
        kind: "tool-call",
        tool: "fetch_email",
        input: { folder: "inbox", authorization: "structured-secret" },
      },
      {
        kind: "tool-result",
        tool: "fetch_email",
        output: {
          count: 2,
          client_secret: "structured-secret",
          optional: undefined,
          received_at: new Date("2026-08-05T00:00:00.000Z"),
        },
      },
    ],
  });

  assert.deepEqual(trace, {
    schema_version: "agentbranch.provider-neutral-trace.v1",
    source_seam: {
      module: "model-gateway",
      contract: "AgentTurn.transcript",
      adapter: "smevals-poc/v1",
    },
    steps: [
      { kind: "model", text: "I will inspect the inbox." },
      { kind: "tool-call", tool: "fetch_email", input: { folder: "inbox" } },
      {
        kind: "tool-result",
        tool: "fetch_email",
        output: { count: 2, optional: null, received_at: "2026-08-05T00:00:00.000Z" },
      },
    ],
  });
});

test("retains structured delegation output in the execution artifact contract", () => {
  const trace = mapAgentTurnToTrace({
    transcript: [
      { kind: "tool-call", tool: "delegate", input: { to: "research-specialist" } },
      { kind: "tool-result", tool: "delegate", output: { accepted: true } },
    ],
  });

  assert.deepEqual(executionArtifactsFromTrace(trace).delegations, [
    { target: "research-specialist", status: "completed", output: { accepted: true } },
  ]);
});

test("resolves an agent configuration through an allowlist and excludes credentials", () => {
  const resolved = credentialFreeAgentConfiguration({
    id: "ac-default-v1",
    runtime_adapter: { id: "deterministic", version: "1", api_key: "adapter-secret" },
    model: {
      provider: "deterministic",
      id: "agentbranch/default-config",
      parameters: { temperature: 0, max_output_tokens: 4096, client_secret: "model-secret" },
      credential: "model-secret",
    },
    instructions: [{ id: "system", content: "Follow the configured instructions." }],
    skills: [{ name: "email-triage", source: "skills/email-triage/SKILL.md" }],
    subagents: [{ name: "research-specialist", source: "agents/research.md" }],
    tools: [{ name: "fetch_email", description: "Read deterministic fixture data." }],
    policies: [{ id: "no-delete", rule: "Never delete email." }],
    secret_requirements: [{ name: "EMAIL_API_KEY", purpose: "Production inbox access." }],
    process_environment: { EMAIL_API_KEY: "environment-secret" },
  });

  assert.equal(resolved.id, "ac-default-v1");
  assert.deepEqual(resolved.secret_requirements, [
    { name: "EMAIL_API_KEY", purpose: "Production inbox access." },
  ]);
  assert.equal(resolved.model.parameters.max_output_tokens, 4096);
  assert.equal("client_secret" in resolved.model.parameters, false);
  assert.equal(JSON.stringify(resolved).includes("adapter-secret"), false);
  assert.equal(JSON.stringify(resolved).includes("model-secret"), false);
  assert.equal(JSON.stringify(resolved).includes("environment-secret"), false);
  assert.equal("process_environment" in resolved, false);
});

test("the executable Runner emits complete credential-free evidence for success", () => {
  const { root, runDir, result } = runScenario("skill-activation", {
    SMEVALS_TASK_SKILL: "email-triage",
  });
  try {
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Skill activated: email-triage/);
    assert.equal(result.stderr, "");

    const configuration = readJson(runDir, "agent-configuration.json");
    assert.equal(configuration.schema_version, "agentbranch.resolved-agent-configuration.v1");
    assert.equal(configuration.id, "ac-default-v1");
    assert.deepEqual(configuration.secret_requirements, []);
    assert.equal(Array.isArray(configuration.instructions), true);
    assert.equal(Array.isArray(configuration.subagents), true);
    assert.equal(Array.isArray(configuration.tools), true);
    assert.equal(Array.isArray(configuration.policies), true);

    const usage = readJson(runDir, "usage.json");
    assert.equal(usage.total_tokens, usage.input_tokens + usage.output_tokens);
    assert.deepEqual(usage.cost, { amount_micros: 0, currency: "USD" });

    const completion = readJson(runDir, "completion.json");
    assert.equal(completion.status, "completed");
    assert.equal(completion.exit_code, 0);
    assert.equal(readJson(runDir, "harness-version.json").runner_contract_version, "1");
    assert.deepEqual(readJson(runDir, "artifacts.json"), {
      schema_version: "agentbranch.execution-artifacts.v1",
      tool_calls: [],
      delegations: [],
      recoveries: [],
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("partial tool failure and recovery remain diagnosable in trace and artifacts", () => {
  const { root, runDir, result } = runScenario("partial-tool-failure-recovery", {
    SMEVALS_TASK_FLAKY_TOOL: "fetch_email",
  });
  try {
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Recovered after one retry/);

    const trace = readJson(runDir, "trace.json");
    assert.equal(trace.steps.length, 6);
    assert.deepEqual(trace.steps[2], {
      kind: "tool-result",
      tool: "fetch_email",
      output: { error: "transient timeout", recovered: false },
    });
    assert.deepEqual(trace.steps[5], {
      kind: "tool-result",
      tool: "fetch_email",
      output: { count: 5, recovered: true },
    });

    const artifacts = readJson(runDir, "artifacts.json");
    assert.deepEqual(
      artifacts.tool_calls.map(({ tool, status }) => ({ tool, status })),
      [
        { tool: "fetch_email", status: "failed" },
        { tool: "fetch_email", status: "completed" },
      ],
    );
    assert.deepEqual(artifacts.recoveries, [
      { tool: "fetch_email", failed_calls: 1, recovered_by_call: 2 },
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a non-zero adapter exit is retained as a diagnosable Runner failure", () => {
  const { root, runDir, result } = runScenario("harness-crash", {
    SMEVALS_TASK_EXPECT_INFRA_FAILURE: "True",
  });
  try {
    assert.equal(result.status, 42);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /simulated harness infrastructure failure \(exit 42\)/);

    const completion = readJson(runDir, "completion.json");
    assert.equal(completion.status, "runner_failed");
    assert.equal(completion.exit_code, 42);
    assert.deepEqual(completion.failure, {
      kind: "runtime_adapter_failure",
      message: "simulated harness infrastructure failure (exit 42) for task harness-crash",
    });
    assert.equal(readJson(runDir, "usage.json").total_tokens, 0);
    assert.deepEqual(readJson(runDir, "trace.json").steps, []);
    assert.equal(existsSync(join(runDir, "stderr.txt")), true);
    assert.match(readFileSync(join(runDir, "stderr.txt"), "utf8"), /exit 42/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an unexpected internal Runner error still retains partial diagnostics", () => {
  const { root, runDir, result } = runScenario("tool-selection-exact-arguments", {
    SMEVALS_TASK_EXPECTED_TOOL: "fetch_email",
    SMEVALS_TASK_EXPECTED_ARGS: "{not-json",
  });
  try {
    assert.equal(result.status, 42);
    assert.match(result.stderr, /Unexpected token|property name/i);
    assert.deepEqual(readJson(runDir, "trace.json").steps, []);
    assert.deepEqual(readJson(runDir, "artifacts.json").tool_calls, []);
    assert.equal(readJson(runDir, "usage.json").total_tokens, 0);
    assert.equal(readJson(runDir, "completion.json").status, "runner_failed");
    assert.equal(readJson(runDir, "completion.json").failure.kind, "runner_error");
    assert.equal(existsSync(join(runDir, "timing.json")), true);
    assert.equal(existsSync(join(runDir, "stderr.txt")), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
