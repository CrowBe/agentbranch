/**
 * Credential-free deterministic runtime adapter for the removable smevals PoC.
 * It returns the model gateway's stable AgentTurn transcript shape and never
 * reads process state, performs I/O, or calls a provider.
 */
export function runDeterministicAdapter(input) {
  if (input.expectInfraFailure) {
    const message = `simulated harness infrastructure failure (exit 42) for task ${input.taskName}`;
    return {
      turn: { transcript: [] },
      output: "",
      stderr: message,
      status: "runner_failed",
      exitCode: 42,
      failure: { kind: "runtime_adapter_failure", message },
    };
  }

  const { transcript, output } = scenarioTurn(input);
  return {
    turn: { transcript },
    output,
    stderr: "",
    status: "completed",
    exitCode: 0,
    failure: null,
  };
}

const model = (text) => ({ kind: "model", text });
const toolCall = (tool, toolInput) => ({ kind: "tool-call", tool, input: toolInput });
const toolResult = (tool, output) => ({ kind: "tool-result", tool, output });

function scenarioTurn(input) {
  const { scenario, skill, expectedTool, delegateTo, forbiddenTool, flakyTool } = input;
  if (scenario === "skill-activation") {
    return {
      transcript: [
        model(`Candidate skill "${skill}": description matches the request.`),
        model(`Activated "${skill}".`),
      ],
      output: `Skill activated: ${skill}. Summary: 3 unread messages, 1 flagged for follow-up.`,
    };
  }
  if (scenario === "skill-non-activation") {
    return {
      transcript: [
        model(`Candidate skill "${skill}": description does not match a haiku request.`),
        model("No matching skill; responding directly."),
      ],
      output: "No matching skill activated; here is a haiku about pelicans.",
    };
  }
  if (scenario === "tool-selection-exact-arguments") {
    const args = JSON.parse(input.expectedArgs ?? "{}");
    return {
      transcript: [
        model(`Selecting tool "${expectedTool}".`),
        toolCall(expectedTool, args),
        toolResult(expectedTool, { count: 5, messages: ["m1", "m2", "m3", "m4", "m5"] }),
      ],
      output: `Fetched 5 messages from inbox using ${expectedTool}.`,
    };
  }
  if (scenario === "delegation-routing") {
    return {
      transcript: [
        model(`Routing research to subagent "${delegateTo}".`),
        toolCall("delegate", { to: delegateTo }),
        toolResult("delegate", { accepted: true }),
      ],
      output: `Delegated research to ${delegateTo}.`,
    };
  }
  if (scenario === "forbidden-behaviour") {
    return {
      transcript: [model(`Refusing: "${forbiddenTool}" is forbidden by policy; no tool call is made.`)],
      output: `Refused: I will not ${forbiddenTool.replace(/_/g, " ")} — that is forbidden behaviour.`,
    };
  }
  if (scenario === "partial-tool-failure-recovery") {
    return {
      transcript: [
        model(`Calling "${flakyTool}".`),
        toolCall(flakyTool, { folder: "inbox" }),
        toolResult(flakyTool, { error: "transient timeout", recovered: false }),
        model("Transient failure; retrying once."),
        toolCall(flakyTool, { folder: "inbox", retry: 1 }),
        toolResult(flakyTool, { count: 5, recovered: true }),
      ],
      output: `Recovered after one retry: ${flakyTool} succeeded on the second attempt.`,
    };
  }
  return {
    transcript: [model(`Unknown scenario "${scenario}"; responding generically.`)],
    output: `Scenario ${scenario} not recognised by the mock Runner.`,
  };
}
