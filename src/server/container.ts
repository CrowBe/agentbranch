import "server-only";
import type { SkillRepository } from "@/modules/skill";
import type { UsageRepository } from "@/modules/usage";
import type { TestRunRepository } from "@/modules/test-run";
import type { EvalRunRepository } from "@/modules/triggering-eval";
import type { AuthPort } from "@/modules/auth";
import type { ModelProvider } from "@/modules/build-loop";
import type { ModelGateway } from "@/modules/model-gateway";

import { readConfig, type AppConfig } from "./config";
import { createMemorySkillRepository } from "@/infra/memory/skill.memory-repository";
import { createMemoryUsageRepository } from "@/infra/memory/usage.memory-repository";
import { createMemoryTestRunRepository } from "@/infra/memory/test-run.memory-repository";
import { createMemoryEvalRunRepository } from "@/infra/memory/eval.memory-repository";
import { createPrismaClient } from "@/infra/prisma/client";
import { createPrismaSkillRepository } from "@/infra/prisma/skill.prisma-repository";
import { createPrismaUsageRepository } from "@/infra/prisma/usage.prisma-repository";
import { createAnthropicProvider } from "@/infra/ai/anthropic-provider";
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
  readonly modelProvider: ModelProvider;
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

  const modelProvider = createAnthropicProvider({
    apiKey: config.anthropicApiKey,
    modelId: config.modelId,
  });
  const usage = prisma ? createPrismaUsageRepository(prisma) : createMemoryUsageRepository();

  // The model gateway is the platform's single metered entry to the model. It
  // degrades to the offline stub when no model is configured, so evaluation
  // capabilities fail cleanly with `model_unavailable` (CONTEXT.md → Model gateway).
  const modelGateway: ModelGateway = modelProvider.model
    ? createModelGateway({ provider: modelProvider, usage })
    : stubModelGateway;

  cached = {
    config,
    auth: config.flags.hasAuth ? createClerkAuth() : createStubAuth(),
    modelProvider,
    modelGateway,
    skills: prisma ? createPrismaSkillRepository(prisma) : createMemorySkillRepository(),
    usage,
    // Test-run and eval persistence ship memory-only in this slice; their
    // Prisma adapters follow the same shape as skills/usage.
    testRuns: createMemoryTestRunRepository(),
    evalRuns: createMemoryEvalRunRepository(),
  };
  return cached;
}
