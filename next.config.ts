import type { NextConfig } from "next";

/**
 * Extra hosts allowed to submit Server Actions when the app runs behind a proxy whose
 * public address differs from the Host header (for example GitHub Codespaces).
 * Exact hosts only: wildcards would let other sites on the same domain submit forms.
 */
function allowedActionOrigins(): string[] {
  const hosts = (process.env.SERVER_ACTIONS_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean);
  const { CODESPACE_NAME, GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN } = process.env;
  if (CODESPACE_NAME && GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN) {
    hosts.push(`${CODESPACE_NAME}-3000.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}`);
    // The Codespaces port-forwarding proxy rewrites the browser's Origin header to localhost:3000.
    hosts.push("localhost:3000");
  }
  return hosts;
}

const nextConfig: NextConfig = {
  // Standalone output is only needed for the Docker image (set in Dockerfile);
  // `next start` (local and E2E) requires the default output.
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  poweredByHeader: false,
  serverExternalPackages: ["@node-rs/argon2", "pino"],
  experimental: {
    // CSV contact imports are uploaded through a server action (files up to 5 MB, see src/lib/csv.ts).
    serverActions: { bodySizeLimit: "6mb", allowedOrigins: allowedActionOrigins() },
  },
};

export default nextConfig;
