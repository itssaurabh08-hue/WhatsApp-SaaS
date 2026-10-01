import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone output is only needed for the Docker image (set in Dockerfile);
  // `next start` (local and E2E) requires the default output.
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  poweredByHeader: false,
  serverExternalPackages: ["@node-rs/argon2", "pino"],
};

export default nextConfig;
