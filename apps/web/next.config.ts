import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  agentRules: false,
}

export default nextConfig
