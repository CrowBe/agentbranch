import { defineConfig } from "prisma/config";

// Prisma 7 keeps connection config out of the schema. The migration URL lives
// here; the runtime client is constructed with a driver adapter in
// src/infra/prisma/client.ts. Both read DATABASE_URL — absent it, the app
// falls back to the in-memory persistence adapter (src/server/container.ts).
//
// Prisma's config loader does not read .env for us, so do it explicitly.
// `db generate` does not connect, so an empty URL is fine when unconfigured.
try {
  process.loadEnvFile(".env");
} catch {
  // No .env file — rely on the ambient environment (CI, Vercel, etc.).
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env.DATABASE_URL ?? "",
  },
});
