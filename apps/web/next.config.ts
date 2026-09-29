import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // @arbiter/shared is a workspace package; let Next compile it with the app.
  transpilePackages: ['@arbiter/shared']
};

export default nextConfig;
