import type { NextConfig } from 'next'

const apiUrl = process.env.API_URL ?? 'http://localhost:3001'

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  agentRules: false,
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiUrl}/:path*` }]
  },
}

export default nextConfig
