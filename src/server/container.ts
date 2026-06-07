import "server-only";
import type { SkillRepository } from "@/modules/skill";
import type { UsageRepository } from "@/modules/usage";
import type { TestRunRepository } from "@/modules/test-run";
import type { EvalRunRepository } from "@/modules/triggering-eval";
import type { AuthPort } from "@/modules/auth";
import type { ModelGateway } from "@/modules/model-gateway";

import { readConfig, type AppConfig } from "./config";
import { createMemorySkillRepository } from "@/infra/memory/skill.memory-repository";
import { createMemoryUsageRepository } from "@/infra/memory/usage.memory-repository";
import { createMemoryTestRunRepository } from "@/infra/memory/test-run.memory-repository";
import { createMemoryEvalRunRepository } from "@/infra/memory/eval.memory-repository";
import { createPrismaClient } from "@/infra/prisma/client";
import { createPrismaSkillRepository } from "@/infra/prisma/skill.prisma-repository";
import { createPrismaUsageRepository } from "@/infra/prisma/usage.prisma-repository";
import { createPrismaTestRunRepository } from "@/infra/prisma/test-run.prisma-repository";
import { createPrismaEvalRunRepository } from "@/infra/prisma/eval.prisma-repository";
import { createUserProvisioningAuth } from "@/infra/prisma/user-provisioning-auth";
import { createAnthropicProvider } from "@/infra/ai/anthropic-provider";
import { createNousProvider } from "@/infra/ai/nous-provider";
import { createModelGateway } from "@/infra/ai/model-gateway";
import { stubModelGateway } from "@/infra/ai/stub-model-gateway";
import { createClerkAuth } from "@/infra/clerk/clerk-auth";
import { createStubAuth } from "@/infra/clerk/stub-auth";

/**
 * The composition root. The one place ports meet adapters; everything else
 * depends on interfaces. Wiring is driven by config flags so the app degrades
 * to memory/stub adapters when secrets are absent (ARCHITECTURE §4 stack).
 */
export type AppContainer = {
  readonly config: AppConfig;
  readonly auth: AuthPort;
  // No raw `modelProvider` is exposed: nothing above the gateway touches the
  // model. The provider is an internal wiring detail of `modelGateway`.
  readonly modelGateway: ModelGateway;
  readonly skills: SkillRepository;
  readonly usage: UsageRepository;
  readonly testRuns: TestRunRepository;
  readonly evalRuns: EvalRunRepository;
};

let cached: AppContainer | null = null;

export function getContainer(): AppContainer {
  if (cached) return cached;
  const config = readConfig();

  const prisma = config.databaseUrl ? createPrismaClient(config.databaseUrl) : null;

  const modelProvider =
    config.modelProvider === "nous"
      ? createNousProvider({
          apiKey: config.nousApiKey,
          modelId: config.modelId,
          baseUrl: config.nousBaseUrl,
        })
      : createAnthropicProvider({
          apiKey: config.anthropicApiKey,
          modelId: config.modelId,
        });
  const usage = prisma ? createPrismaUsageRepository(prisma) : createMemoryUsageRepository();

  // The model gateway is the platform's single metered entry to the model. It
  // degrades to the offline stub when no model is configured, so evaluation
  // capabilities fail cleanly with `model_unavailable` (CONTEXT.md → Model gateway).
  const modelGateway: ModelGateway = modelProvider.model
    ? createModelGateway({
        provider: modelProvider,
        usage,
        providerKind: config.modelProvider,
        modelId: config.modelId,
      })
    : stubModelGateway;

  const auth = config.flags.hasAuth ? createClerkAuth() : createStubAuth();

  cached = {
    config,
    auth: prisma && config.flags.hasAuth ? createUserProvisioningAuth(auth, prisma) : auth,
    modelGateway,
    skills: prisma ? createPrismaSkillRepository(prisma) : createMemorySkillRepository(),
    usage,
    testRuns: prisma ? createPrismaTestRunRepository(prisma) : createMemoryTestRunRepository(),
    evalRuns: prisma ? createPrismaEvalRunRepository(prisma) : createMemoryEvalRunRepository(),
  };
  return cached;
}
