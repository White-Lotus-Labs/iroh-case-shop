import type { NextConfig } from 'next';

const cache = (value: string) => [{ key: 'Cache-Control', value }];

const config: NextConfig = {
  agentRules: false,
  turbopack: { root: process.cwd() },
  devIndicators: false,
  async headers() {
    // Later rules win for the same header. Only names with a content hash
    // (`name.abc123.webp`) may be immutable; a plain name must be able to change.
    return [
      {
        source: '/images/:path*',
        headers: cache('public, max-age=604800, stale-while-revalidate=86400'),
      },
      {
        source: '/:dir(images|audio|models)/:path(.*\\.[0-9a-f]{6}\\.\\w+)',
        headers: cache('public, max-age=31536000, immutable'),
      },
    ];
  },
};
export default config;
