import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Ensure Turbopack treats the monorepo root (with bun.lockb) as the project root.
  turbopack: {
    root: path.join(__dirname, "../.."),
  },

  // Disable image optimization
  images: {
    unoptimized: true,
  },

  // Proxy API in dev to avoid CORS/port issues.
  async rewrites() {
    if (process.env.NODE_ENV === "production") return [];
    return [
      {
        source: "/api/:path*",
        destination: "http://localhost:3001/api/:path*",
      },
      {
        source: "/health",
        destination: "http://localhost:3001/health",
      },
    ];
  },
};

export default nextConfig;
