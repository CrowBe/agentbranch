import { afterAll, beforeAll, describe } from "vitest";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { agentConfigurationRepositoryContract } from "@/infra/memory/agent-configuration.memory-repository.test";
import { createPrismaAgentConfigurationRepository } from "./agent-configuration.prisma-repository";

const databaseUrl = process.env.DATABASE_URL;

describe.skipIf(!databaseUrl)("AgentConfigurationRepository Prisma contract", () => {
  let prisma: PrismaClient;
  beforeAll(() => {
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl! }) });
  });
  afterAll(async () => prisma.$disconnect());
  agentConfigurationRepositoryContract(() => createPrismaAgentConfigurationRepository(prisma));
});
