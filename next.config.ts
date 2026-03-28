import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  serverExternalPackages: ['better-sqlite3', 'pino', 'sharp', 'playwright'],
};

export default nextConfig;
