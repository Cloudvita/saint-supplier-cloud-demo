import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Produces a minimal self-contained server bundle -> small Docker image for App Runner
  output: "standalone",
  eslint: { ignoreDuringBuilds: true },
  experimental: {
    serverActions: {
      bodySizeLimit: "12mb", // W-9 PDFs / scans
    },
  },
};

export default nextConfig;
