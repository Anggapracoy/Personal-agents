import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["quickjs-emscripten", "quickjs-emscripten-core"],
  devIndicators: false,
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  turbopack: { root: process.cwd() },
};

export default nextConfig;
