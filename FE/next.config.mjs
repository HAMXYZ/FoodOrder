const nextConfig = {
  images: { unoptimized: true },
  // A single worker keeps Windows builds deterministic on synced/guarded folders.
  experimental: { cpus: 1 },
};
export default nextConfig;
