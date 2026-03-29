import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  serverExternalPackages: ['better-sqlite3', 'pino', 'sharp', 'playwright'],
  webpack: (config, { isServer }) => {
    // Ignore .autodev directory — coding agents create/modify files there,
    // which triggers unwanted recompilation and corrupts the dev server cache.
    config.watchOptions = {
      ...config.watchOptions,
      ignored: [
        ...(Array.isArray(config.watchOptions?.ignored) ? config.watchOptions.ignored : []),
        '**/.autodev/**',
      ],
    };
    return config;
  },
};

export default nextConfig;
