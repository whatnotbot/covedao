import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";

// Load the monorepo-root .env so both web + worker share one configuration.
loadEnv({ path: fileURLToPath(new URL("../../.env", import.meta.url)) });

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: [
    "@crclaunch/config",
    "@crclaunch/curve",
    "@crclaunch/db",
    "@crclaunch/protocol",
    "@crclaunch/wallets",
  ],
  serverExternalPackages: ["pg", "ioredis", "bullmq"],
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  images: {
    remotePatterns: [{ protocol: "https", hostname: "**" }],
  },
  webpack: (config) => {
    // Workspace packages use ESM-style `.js` import specifiers that resolve to
    // `.ts` sources; teach webpack to resolve them (TS/tsx already do natively).
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
};

export default nextConfig;
