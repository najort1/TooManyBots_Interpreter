import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const apiTarget = process.env.FUN_API_URL || "http://127.0.0.1:8790";
const rootDir = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  // O catálogo de avatar é compartilhado com o backend do monorepo.
  outputFileTracingRoot: path.resolve(rootDir, ".."),
  allowedDevOrigins: ["*.trycloudflare.com", "localhost:3001", "127.0.0.1:3001"],
  async rewrites() {
    return [
      {
        source: "/api/fun/:path*",
        destination: `${apiTarget}/api/fun/:path*`,
      },
    ];
  },
};

export default nextConfig;
