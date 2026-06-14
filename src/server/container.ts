import "server-only";
import type { SkillRepository } from "@/modules/skill";
import type { RequestRateLimiter, Tier, UsageRepository } from "@/modules/usage";
import type { TestRunRepository } from "@/modules/test-run";
import type { EvalRunRepository } from "@/modules/triggering-eval";
import type { AuthPort } from "@/modules/auth";
import type { ModelGateway } from "@/modules/model-gateway";
import type { ModelRouter } from "@/modules/model-router";

import { readConfig, type AppConfig } from "./config";
import { createMemorySkillRepository } from "@/infra/memory/skill.memory-repository";
import { createMemoryUsageRepository } from "@/infra/memory/usage.memory-repository";
import { createMemoryRequestRateLimiter } from "@/infra/memory/rate-limit.memory-repository";
import { createMemoryTestRunRepository } from "@/infra/memory/test-run.memory-repository";
import { createMemoryEvalRunRepository } from "@/infra/memory/eval.memory-repository";
import { createPrismaClient } from "@/infra/prisma/client";
import { createPrismaSkillRepository } from "@/infra/prisma/skill.prisma-repository";
import { createPrismaUsageRepository } from "@/infra/prisma/usage.prisma-repository";
import { createPrismaRequestRateLimiter } from "@/infra/prisma/rate-limit.prisma-repository";
import { createPrismaTestRunRepository } from "@/infra/prisma/test-run.prisma-repository";
import { createPrismaEvalRunRepository } from "@/infra/prisma/eval.prisma-repository";
import { createUserProvisioningAuth } from "@/infra/prisma/user-provisioning-auth";
import { createModelRouter } from "@/infra/ai/model-router";
import { createModelGateway } from "@/infra/ai/model-gateway";
import { createClerkAuth } from "@/infra/clerk/clerk-auth";
import { createStubAuth } from "@/infra/clerk/stub-auth";
import { createClerkTierResolver } from "@/infra/clerk/tier-resolver";

/**
 * The composition root. The one place ports meet adapters; everything else
 * depends on interfaces. Wiring is driven by config flags so the app degrades
 * to memory/stub adapters when secrets are absent (ARCHITECTURE §4 stack).
 */
export type AppContainer = {
  readonly config: AppConfig;
  readonly auth: AuthPort;
  // No raw model provider is exposed: nothing above the gateway touches the
  // model. The router (provider/model selection + credentials) is an internal
  // wiring detail of the gateway, exposed only so the model-console route can
  // read the registry and switch the active selection at runtime.
  readonly modelGateway: ModelGateway;
  readonly modelRouter: ModelRouter;
  readonly skills: SkillRepository;
  readonly usage: UsageRepository;
  readonly requestRateLimiter: RequestRateLimiter;
  readonly tierFor: (userId: import("@/shared").UserId) => Promise<Tier>;
  readonly testRuns: TestRunRepository;
  readonly evalRuns: EvalRunRepository;
};

let cached: AppContainer | null = null;

export function getContainer(): AppContainer {
  if (cached) return cached;
  const config = readConfig();

  const prisma = config.databaseUrl ? createPrismaClient(config.databaseUrl) : null;

  // The model router owns provider/model selection + credentials (server pool
  // now, bring-your-own override at runtime). The gateway resolves the model
  // through it per call, so the active provider/model can change at runtime via
  // the model console without re-wiring (ARCHITECTURE §4 routing).
  const modelRouter = createModelRouter({
    profiles: config.providerRegistry,
    serverKeys: config.serverKeys,
    defaultSelection: config.defaultSelection,
  });
  const usage = prisma ? createPrismaUsageRepository(prisma) : createMemoryUsageRepository();
  const requestRateLimiter = prisma
    ? createPrismaRequestRateLimiter(prisma)
    : createMemoryRequestRateLimiter();
  const tierFor = config.flags.hasAuth
    ? createClerkTierResolver(config.clerkProPlanSlug)
    : undefined;

  // The model gateway is the platform's single metered entry to the model. It
  // resolves through the router, so `hasModel` reflects the active selection and
  // an unconfigured router fails cleanly with `model_unavailable` (CONTEXT.md →
  // Model gateway) — no separate offline stub needed.
  const modelGateway: ModelGateway = createModelGateway({
    router: modelRouter,
    usage,
    requestRateLimiter,
    tierFor,
  });

  const auth = config.flags.hasAuth ? createClerkAuth() : createStubAuth();

  cached = {
    config,
    auth: prisma && config.flags.hasAuth ? createUserProvisioningAuth(auth, prisma) : auth,
    modelGateway,
    modelRouter,
    skills: prisma ? createPrismaSkillRepository(prisma) : createMemorySkillRepository(),
    usage,
    requestRateLimiter,
    tierFor: tierFor ?? (async () => "free" as Tier),
    testRuns: prisma ? createPrismaTestRunRepository(prisma) : createMemoryTestRunRepository(),
    evalRuns: prisma ? createPrismaEvalRunRepository(prisma) : createMemoryEvalRunRepository(),
  };
  return cached;
}
