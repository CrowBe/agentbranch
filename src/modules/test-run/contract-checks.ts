import {
  exampleValueForSchema,
  responseSchemaName,
  validateAgainstSchema,
  type ResponseSchemaSource,
} from "@/modules/response-schema";
import type { ToolContractIo, ToolContractSource } from "@/modules/tool-contract";
import { createMockToolRegistry } from "./mock-tool-registry";
import type { ContractCallCheck, ContractCheck, MockToolRegistry, TranscriptStep } from "./test-run.types";

/**
 * The contract-driven mock world (ARCHITECTURE §9.2): each Tool contract in a
 * bundle becomes a mock tool whose response conforms to the contract's output
 * schema — an author-declared example output first, then a deterministic
 * example value built from the (possibly response-schema-referenced) schema.
 * Nothing real is touched, same as every test run.
 */
export function registryFromContracts(
  contracts: readonly ToolContractSource[],
  schemas: readonly ResponseSchemaSource[],
): MockToolRegistry {
  return createMockToolRegistry(
    contracts.map((contract) => {
      const response = mockOutputForContract(contract, schemas);
      return {
        name: contract.name,
        description: contract.description,
        respond: () => response,
      };
    }),
  );
}

/**
 * The relational validation itself, computed from the finished transcript:
 * per supplied contract, was the tool called, did each call's arguments match
 * the contract's input schema, and did the output it handled match the output
 * schema? Pure — the transcript already carries every call and result.
 */
export function computeContractChecks(
  transcript: readonly TranscriptStep[],
  contracts: readonly ToolContractSource[],
  schemas: readonly ResponseSchemaSource[],
): readonly ContractCheck[] {
  return contracts.map((contract) => {
    const inputSchema = resolveIoSchema(contract.input, schemas);
    const outputSchema = resolveIoSchema(contract.output, schemas);

    const calls: ContractCallCheck[] = [];
    let pendingCall: number | null = null;
    for (const step of transcript) {
      if (step.kind === "tool-call" && step.tool === contract.name) {
        calls.push({
          call: calls.length + 1,
          argumentIssues: inputSchema
            ? validateAgainstSchema(step.input, inputSchema, "arguments")
            : [],
          outputIssues: [],
        });
        pendingCall = calls.length - 1;
      } else if (step.kind === "tool-result" && step.tool === contract.name && pendingCall !== null) {
        const check = calls[pendingCall];
        if (check && outputSchema) {
          calls[pendingCall] = {
            ...check,
            outputIssues: validateAgainstSchema(step.output, outputSchema, "output"),
          };
        }
        pendingCall = null;
      }
    }

    return { tool: contract.name, called: calls.length > 0, calls };
  });
}

/** Plain-language lines for the checks — shared by the Insights renderer's
 * deterministic `watch` merge and the insight prompt. Empty when every
 * contract was called cleanly. */
export function contractCheckIssues(checks: readonly ContractCheck[]): readonly string[] {
  const issues: string[] = [];
  for (const check of checks) {
    if (!check.called) {
      issues.push(
        `The skill never called \`${check.tool}\` even though its tool contract was supplied.`,
      );
      continue;
    }
    for (const call of check.calls) {
      if (call.argumentIssues.length > 0) {
        issues.push(
          `Call ${call.call} to \`${check.tool}\` did not match the contract's input schema: ${call.argumentIssues[0]}`,
        );
      }
      if (call.outputIssues.length > 0) {
        issues.push(
          `Call ${call.call} to \`${check.tool}\` returned output that did not match the contract's output schema: ${call.outputIssues[0]}`,
        );
      }
    }
  }
  return issues;
}

/** Resolve one I/O side to a concrete schema: inline as-is; a `$ref` by the
 * referenced response schema's title. Unresolvable → undefined (unvalidated). */
export function resolveIoSchema(
  io: ToolContractIo | undefined,
  schemas: readonly ResponseSchemaSource[],
): Readonly<Record<string, unknown>> | undefined {
  if (io === undefined) return undefined;
  if (io.kind === "inline") return io.schema;
  return schemas.find((schema) => responseSchemaName(schema) === io.ref)?.document;
}

function mockOutputForContract(
  contract: ToolContractSource,
  schemas: readonly ResponseSchemaSource[],
): unknown {
  const example = contract.examples.find((item) => item.output !== undefined);
  if (example) return example.output;
  const outputSchema = resolveIoSchema(contract.output, schemas);
  return outputSchema ? exampleValueForSchema(outputSchema) : {};
}
