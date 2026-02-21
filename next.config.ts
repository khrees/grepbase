import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Next.js automatically detects Vercel out of the box so no `output: 'export'` or 'standalone' needed by default.
  typescript: {
    ignoreBuildErrors: true,
  }
};

export default nextConfig;
