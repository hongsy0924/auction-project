import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // output: 'export',
  reactStrictMode: true,
  // Prevent bundling of sqlite3 (native module)
  serverExternalPackages: ["sqlite3"],
  webpack: (config, { dev }) => {
    // Hack to fix Node.js v25+ localStorage issue
    if (typeof global.localStorage !== "undefined") {
      try {
        Object.defineProperty(global, "localStorage", {
          value: undefined,
          writable: true,
        });
      } catch (e) {
        console.error("Failed to patch localStorage:", e);
      }
    }

    if (dev) {
      // Use absolute path to be sure
      const dbPath = path.join(__dirname, "database");
      const cachePath = path.join(__dirname, "cache");
      const outputPath = path.join(__dirname, "output");
      config.watchOptions = {
        ...config.watchOptions,
        // Ignored can accept absolute paths
        ignored: [
          "**/node_modules/**",
          "**/.git/**",
          dbPath,
          path.join(dbPath, "**/*"),
          cachePath,
          path.join(cachePath, "**/*"),
          outputPath,
          path.join(outputPath, "**/*"),
        ],
      };
    }
    return config;
  },
};

export default nextConfig;
