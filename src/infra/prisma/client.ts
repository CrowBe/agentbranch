import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * Construct a PrismaClient with the pg driver adapter (Prisma 7 requires a
 * driver adapter — see prisma.config.ts). The composition root only calls this
 * when DATABASE_URL is present; otherwise persistence uses the memory adapters.
 */
export function createPrismaClient(databaseUrl: string): PrismaClient {
  const adapter = new PrismaPg({ connectionString: databaseUrl });
  return new PrismaClient({ adapter });
}
