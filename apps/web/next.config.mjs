/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@chatofy/types', '@chatofy/config'],
  experimental: {
    typedRoutes: true,
  },
};

export default nextConfig;
