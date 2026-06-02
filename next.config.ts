import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Domain modules are pure TS and safe to optimise across the server bundle.
  // Presentation, infra adapters, and the build-loop route handler are the
  // only places allowed to reach for Node/Clerk/Prisma/AI-SDK primitives.
  typedRoutes: true,
};

export default nextConfig;
