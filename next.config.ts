import path from 'path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname),
  },
  // Next.js automatically detects Vercel out of the box so no `output: 'export'` or 'standalone' needed by default.
};

export default nextConfig;
