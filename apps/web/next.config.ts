import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@chatofy/types', '@chatofy/config'],
  experimental: {
    typedRoutes: true,
  },
};

export default nextConfig;
