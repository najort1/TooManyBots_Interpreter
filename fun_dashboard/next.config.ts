import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const apiTarget = process.env.FUN_API_URL || "http://127.0.0.1:8790";
const rootDir = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  // monorepo: evita Next achar o lockfile da raiz do repo
  outputFileTracingRoot: rootDir,
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
