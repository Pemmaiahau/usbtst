import type { NextConfig } from "next";

// Static export: the whole site is plain files, so it can be hosted on any free static host.
// NEXT_PUBLIC_BASE_PATH is set by the GitHub Pages workflow ("/<repo-name>"); empty elsewhere.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  basePath,
  images: { unoptimized: true },
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
