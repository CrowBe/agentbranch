import {
  runEvaluation,
  type Artifact,
  type EvaluationCapability,
  type EvaluationObserver,
} from "@/modules/skill-analysis";
import type { ResponseSchemaSource } from "@/modules/response-schema";
import type { Skill, SkillRepository, SkillSource } from "@/modules/skill";
import type { ModelGateway } from "@/modules/model-gateway";
import type { HarnessVersion } from "@/modules/harness-version";
import {
  testRunCapability,
  type TestRunInput,
  type TestRunRepository,
  type TestRunResult,
} from "@/modules/test-run";
import type { ToolContractSource } from "@/modules/tool-contract";
import {
  triggeringEvalCapability,
  type EvalRunRepository,
  type TriggeringResult,
} from "@/modules/triggering-eval";
import {
  encodeSse,
  err,
  isErr,
  ok,
  domainError,
  SkillBranchId,
  SkillId,
  type DomainError,
  type EvaluationEvent,
  type HarnessVersionId,
  type Result,
  type SkillVersionId,
  type UserId,
} from "@/shared";
import { domainErrorResponse } from "./http";

/**
 * The recorded-evaluation driver — the one home for the run every evaluation
 * route shares (the seam's `runEvaluation`, then the persistence choreography:
 * pin the version, stamp the harness version, record the Evaluation record) and
 * for shaping the result as an HTTP response (SSE stream or JSON). Routes stay
 * thin adapters: parse, authenticate, call `evaluationResponse`. Mirrors
 * `build-stream.ts`, the build loop's driver.
 *
 * The domain `model_unavailable` guard lives once, in the seam's
 * `runEvaluation`; the `hasModel` read here is HTTP shaping only — it decides
 * "503 or stream" before any stream opens, never re-states the domain rule.
 */

/** The evaluation capabilities the driver can run — a closed set; the compiler
 * checks the record dispatch stays exhaustive as capabilities are added. */
export type EvaluationRunKind = "test-run" | "triggering-eval";

export type EvaluationSurface = "insights" | "breakdown";

/**
 * What the evaluation record should pin to (ARCHITECTURE §6, §9.3). `skillId`
 * is the persisted skill the request names (null = unsaved, no pin); `branchId`
 * is the draft being iterated on (null = the main version).
 */
export type EvaluationPin = {
  readonly skillId: string | null;
  readonly branchId: string | null;
};

/**
 * The equipment half of a test-run bundle (ARCHITECTURE §9.2): Tool contracts
 * to run the skill against plus the Response schemas they reference. Ignored
 * by capabilities whose input is the Skill alone (triggering eval).
 */
export type EvaluationEquipment = {
  readonly toolContracts?: readonly ToolContractSource[];
  readonly responseSchemas?: readonly ResponseSchemaSource[];
};

/** The ports the run needs, handed in so tests drive it with memory adapters. */
export type EvaluationRunDeps = {
  readonly gateway: ModelGateway;
  readonly skills: SkillRepository;
  readonly testRuns: TestRunRepository;
  readonly evalRuns: EvalRunRepository;
  readonly currentHarnessVersion: () => Promise<Result<HarnessVersion, DomainError>>;
};

/** The run's outcome: rendered surface for display, raw artifact for the client's
 * eval-feedback flow. Mirrors the seam's `EvaluationOutcome`, untyped at this
 * edge because the two capabilities' artifacts differ. */
export type RecordedEvaluation = {
  readonly body: unknown;
  readonly artifact: unknown;
};

export function wantsSse(request: Request): boolean {
  return request.headers.get("accept")?.includes("text/event-stream") ?? false;
}

/**
 * Run an evaluation capability and answer with the right HTTP shape: a 503
 * offline (before any stream opens), an SSE stream of progress → cases →
 * artifact when asked for one, or plain JSON.
 */
export async function evaluationResponse(input: {
  readonly kind: EvaluationRunKind;
  readonly surface: EvaluationSurface;
  readonly sse: boolean;
  readonly skill: Skill;
  readonly pin: EvaluationPin;
  readonly deps: EvaluationRunDeps;
  readonly equipment?: EvaluationEquipment;
}): Promise<Response> {
  const { kind, surface, skill, pin, deps, equipment } = input;

  if (!deps.gateway.hasModel) {
    return domainErrorResponse(
      domainError(
        "model_unavailable",
        `"${capabilityName(kind)}" needs a model connection to run. Test runs and triggering evals are unavailable offline.`,
      ),
    );
  }

  if (input.sse) return evaluationStreamResponse(kind, surface, skill, pin, deps, equipment);

  const outcome = await runRecordedEvaluation(kind, surface, skill, pin, deps, undefined, equipment);
  if (isErr(outcome)) return domainErrorResponse(outcome.error);
  return Response.json(outcome.value.body);
}

/**
 * The recorded run itself, response shaping aside: evaluate through the seam
 * (which guards `model_unavailable`), then pin → stamp → record. Exported so
 * tests exercise the choreography against memory adapters without HTTP.
 */
export async function runRecordedEvaluation(
  kind: EvaluationRunKind,
  surface: EvaluationSurface,
  skill: Skill,
  pin: EvaluationPin,
  deps: EvaluationRunDeps,
  observer?: EvaluationObserver,
  equipment?: EvaluationEquipment,
): Promise<Result<RecordedEvaluation, DomainError>> {
  switch (kind) {
    case "test-run":
      return runEntry(testRunEntry, surface, skill, pin, deps, observer, equipment);
    case "triggering-eval":
      return runEntry(triggeringEvalEntry, surface, skill, pin, deps, observer, equipment);
    default:
      return unreachable(kind);
  }
}

/**
 * Resolve the version an evaluation record pins to. When the pin names a draft,
 * the draft's head; otherwise the skill's main version. Either way only when
 * the evaluated source matches the stored head — an unsaved in-flight edit
 * records with a null pin. This is what makes evaluation *attach to the branch
 * version*, so Insights reflect the draft rather than the blessed version.
 */
export async function resolvePinnedVersionId(
  skills: SkillRepository,
  skill: Skill,
  pin: EvaluationPin,
): Promise<Result<SkillVersionId | null, DomainError>> {
  if (!pin.skillId) return ok(null);
  const skillId = SkillId(pin.skillId);

  if (pin.branchId) {
    const versions = await skills.listBranchVersions(
      skillId,
      skill.userId,
      SkillBranchId(pin.branchId),
    );
    if (!versions.ok) return err(versions.error);
    const head = versions.value[0]; // newest revision first
    if (head && sameSkillSource(head.source, skill.source)) return ok(head.id);
    return ok(null);
  }

  const persisted = await skills.findById(skillId, skill.userId);
  if (!persisted.ok) return err(persisted.error);
  if (!persisted.value) return ok(null);
  if (
    !persisted.value.latestVersionId ||
    !sameSkillSource(persisted.value.source, skill.source)
  ) {
    return ok(null);
  }
  return ok(persisted.value.latestVersionId);
}

function sameSkillSource(a: SkillSource, b: SkillSource): boolean {
  return (
    a.frontmatter.name === b.frontmatter.name &&
    a.frontmatter.description === b.frontmatter.description &&
    JSON.stringify(a.frontmatter.extra) === JSON.stringify(b.frontmatter.extra) &&
    a.body === b.body
  );
}

/** Every record row shares this base; the entry adds its capability's fields. */
type RecordBase = {
  readonly userId: UserId;
  readonly skillId: SkillId;
  readonly skillVersionId: SkillVersionId | null;
  readonly harnessVersionId: HarnessVersionId;
};

/** One arm of the kind-keyed dispatch: which capability to run, how the
 * request's skill (+ equipment) becomes the capability's `Input` — the seam's
 * generic slot at work — and how its artifact becomes the capability's
 * Evaluation record row. */
type EvaluationEntry<Input, A extends Artifact> = {
  readonly capability: EvaluationCapability<Input, A, Record<EvaluationSurface, unknown>>;
  input(skill: Skill, equipment: EvaluationEquipment | undefined): Input;
  record(
    deps: EvaluationRunDeps,
    base: RecordBase,
    artifact: A,
  ): Promise<Result<unknown, DomainError>>;
};

const testRunEntry: EvaluationEntry<TestRunInput, TestRunResult> = {
  capability: testRunCapability,
  input: (skill, equipment) => ({
    skill,
    toolContracts: equipment?.toolContracts,
    responseSchemas: equipment?.responseSchemas,
  }),
  record: (deps, base, artifact) =>
    deps.testRuns.record({
      ...base,
      status: "completed",
      scenario: artifact.scenario,
      transcript: artifact.transcript,
    }),
};

const triggeringEvalEntry: EvaluationEntry<Skill, TriggeringResult> = {
  capability: triggeringEvalCapability,
  input: (skill) => skill,
  record: (deps, base, artifact) =>
    deps.evalRuns.record({
      ...base,
      status: artifact.passed ? "passed" : "failed",
      result: artifact,
    }),
};

async function runEntry<Input, A extends Artifact>(
  entry: EvaluationEntry<Input, A>,
  surface: EvaluationSurface,
  skill: Skill,
  pin: EvaluationPin,
  deps: EvaluationRunDeps,
  observer?: EvaluationObserver,
  equipment?: EvaluationEquipment,
): Promise<Result<RecordedEvaluation, DomainError>> {
  const outcome = await runEvaluation(
    entry.capability,
    surface,
    entry.input(skill, equipment),
    deps.gateway,
    observer,
  );
  if (isErr(outcome)) return outcome;

  observer?.({ kind: "progress", message: `Recording ${entry.capability.name}.` });
  const skillVersionId = await resolvePinnedVersionId(deps.skills, skill, pin);
  if (isErr(skillVersionId)) return skillVersionId;
  const harnessVersion = await deps.currentHarnessVersion();
  if (isErr(harnessVersion)) return harnessVersion;

  const recorded = await entry.record(
    deps,
    {
      userId: skill.userId,
      skillId: skill.id,
      skillVersionId: skillVersionId.value,
      harnessVersionId: harnessVersion.value.id,
    },
    outcome.value.artifact,
  );
  if (isErr(recorded)) return recorded;

  return ok({ body: outcome.value.body, artifact: outcome.value.artifact });
}

/** Bridge the run to an SSE Response: observer events map onto the kernel's
 * `EvaluationEvent` envelope; the artifact (or error) closes the stream. */
function evaluationStreamResponse(
  kind: EvaluationRunKind,
  surface: EvaluationSurface,
  skill: Skill,
  pin: EvaluationPin,
  deps: EvaluationRunDeps,
  equipment?: EvaluationEquipment,
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: EvaluationEvent) =>
        controller.enqueue(encoder.encode(encodeSse(event)));
      const observer: EvaluationObserver = (event) => {
        if (event.kind === "progress") {
          send({ event: "eval-progress", data: { message: event.message } });
        } else {
          const { kind: _kind, ...data } = event;
          send({ event: "eval-case", data });
        }
      };

      try {
        const outcome = await runRecordedEvaluation(
          kind,
          surface,
          skill,
          pin,
          deps,
          observer,
          equipment,
        );
        if (isErr(outcome)) {
          send({
            event: "error",
            data: { message: outcome.error.message, code: outcome.error.tag },
          });
          return;
        }
        send({
          event: "artifact",
          data: { surface, body: outcome.value.body, result: outcome.value.artifact },
        });
      } catch (cause) {
        send({ event: "error", data: { message: String(cause) } });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

function capabilityName(kind: EvaluationRunKind): string {
  switch (kind) {
    case "test-run":
      return testRunCapability.name;
    case "triggering-eval":
      return triggeringEvalCapability.name;
    default:
      return unreachable(kind);
  }
}

function unreachable(kind: never): never {
  throw new Error(`Unknown evaluation kind: ${String(kind)}`);
}
