import type { NextConfig } from "next";

/**
 * - `output: "standalone"` produces a self-contained server build for the Docker image.
 * - `serverExternalPackages` keeps Prisma and bcryptjs out of the bundler so their
 *   native/engine assets are traced and copied into the standalone output.
 */
const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["@prisma/client", "bcryptjs"],
};

export default nextConfig;