import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  agentRules: true,
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
