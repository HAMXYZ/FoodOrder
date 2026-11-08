/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    const backend = (process.env.FOODORDER_API_URL || 'http://127.0.0.1:8000').replace(/\/$/, '')
    // Authenticated dynamic Route Handlers must run before the generic API proxy.
    return { fallback: [{ source: '/api/:path*', destination: `${backend}/api/:path*` }] }
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
}

export default nextConfig
