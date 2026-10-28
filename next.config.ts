import type { NextConfig } from 'next';

const apiProxyTarget = process.env.API_PROXY_TARGET;

const nextConfig: NextConfig = {
  distDir: 'build',
  images: {
    unoptimized: true,
  },
  trailingSlash: true,
  turbopack: {
    rules: {
      '*.svg': {
        loaders: [
          {
            loader: '@svgr/webpack',
            options: {
              icon: true,
            },
          },
        ],
        as: '*.js',
      },
    },
  },
  async rewrites() {
    if (!apiProxyTarget) {
      return [];
    }

    return [
      {
        source: '/gateway/:path*',
        destination: `${apiProxyTarget}/gateway/:path*`,
      },
    ];
  },
};

export default nextConfig;
