import { fileURLToPath } from "node:url";

/** @type {import('next').NextConfig} */
const nextConfig = {
  devIndicators: false,
  output: "standalone",
  outputFileTracingRoot: fileURLToPath(new URL("../..", import.meta.url)),
  serverExternalPackages: ["@crispr/observability"],
  transpilePackages: [
    "@crispr/human-model",
    "@crispr/ui",
    "@crispr/chat-agent",
  ],
  async headers() {
    return [
      {
        source: "/models/human/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
