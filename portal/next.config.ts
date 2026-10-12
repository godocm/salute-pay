import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The independently deployed portal does not need the parent lockfile or state.
  outputFileTracingRoot: process.cwd(),
};

export default nextConfig;
