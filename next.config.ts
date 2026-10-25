import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // This is an authenticated, per-user, always-dynamic workspace, so we render
  // on request rather than using Cache Components' static shell model.
  cacheComponents: false,
  serverExternalPackages: ["postgres"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
