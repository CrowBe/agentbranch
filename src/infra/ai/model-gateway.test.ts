import { describe, it, expect } from "vitest";
import { z } from "zod";
import { createModelGateway } from "./model-gateway";
import { stubModelGateway } from "./stub-model-gateway";
import { createMemoryUsageRepository } from "@/infra/memory/usage.memory-repository";
import { TIER_LIMITS } from "@/modules/usage";
import type { ModelProvider } from "@/modules/build-loop";
import type { AccountingTag } from "@/modules/model-gateway";
import { isErr, UserId } from "@/shared";

/** A provider with a truthy model — enough to pass the no-model guard. The
 *  accounting checks under test all resolve *before* any SDK call, so the model
 *  is never actually invoked here. */
const withModel: ModelProvider = { model: {} as ModelProvider["model"] };
const noModel: ModelProvider = { model: null };

const account = (id: string): AccountingTag => ({
  kind: "account",
  userId: UserId(id),
  capability: "test-run",
});
const platform: AccountingTag = { kind: "platform", reason: "test" };

describe("model gateway — accounting guard", () => {
  it("fails model_unavailable when no model is configured", async () => {
    const gateway = createModelGateway({
      provider: noModel,
      usage: createMemoryUsageRepository(),
    });
    expect(gateway.hasModel).toBe(false);

    const result = await gateway.classify({
      prompt: "x",
      choices: ["a"],
      tag: platform,
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.tag).toBe("model_unavailable");
  });

  it("fails cap_reached when an account call is over its tier cap", async () => {
    const usage = createMemoryUsageRepository();
    const userId = "capped";
    // Push the user past the free token cap so checkCap denies.
    await usage.increment(UserId(userId), {
      tokens: TIER_LIMITS.free.maxTokens,
      turns: 0,
    });
    const gateway = createModelGateway({ provider: withModel, usage });

    const result = await gateway.classify({
      prompt: "x",
      choices: ["a"],
      tag: account(userId),
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.tag).toBe("cap_reached");
  });

  it("gates against the capability the caller declares, not a fixed one", async () => {
    // A user well under the free token + turn budget, but running a capability
    // the free tier disallows (triggering-eval, ARCHITECTURE §8). The gateway
    // must read the cap from the tag — gating it — rather than admitting it
    // under some hardcoded capability.
    const usage = createMemoryUsageRepository();
    const gateway = createModelGateway({ provider: withModel, usage });

    const result = await gateway.classify({
      prompt: "x",
      choices: ["a"],
      tag: { kind: "account", userId: UserId("free-user"), capability: "triggering-eval" },
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.tag).toBe("cap_reached");
  });

  it("does not cap-gate platform calls (the platform owns that cost)", async () => {
    const usage = createMemoryUsageRepository();
    const userId = "capped";
    await usage.increment(UserId(userId), {
      tokens: TIER_LIMITS.free.maxTokens,
      turns: 0,
    });
    const gateway = createModelGateway({ provider: withModel, usage });

    // A platform-tagged call skips the cap; with a fake model it fails at the
    // SDK call, *not* with cap_reached. We only assert the failure is NOT a cap.
    const result = await gateway.classify({
      prompt: "x",
      choices: ["a"],
      tag: platform,
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.tag).not.toBe("cap_reached");
  });
});

describe("stub model gateway", () => {
  it("is offline and fails both primitives with model_unavailable", async () => {
    expect(stubModelGateway.hasModel).toBe(false);
    const c = await stubModelGateway.classify({ prompt: "x", choices: ["a"], tag: platform });
    const r = await stubModelGateway.runAgent({ system: "", messages: [], tools: [], tag: platform });
    const g = await stubModelGateway.generate({
      system: "",
      prompt: "x",
      schema: z.object({ ok: z.boolean() }),
      tag: platform,
    });
    expect(isErr(c) && c.error.tag).toBe("model_unavailable");
    expect(isErr(r) && r.error.tag).toBe("model_unavailable");
    expect(isErr(g) && g.error.tag).toBe("model_unavailable");
  });
});
