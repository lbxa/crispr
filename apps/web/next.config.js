import { fileURLToPath } from "node:url";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants.js";

// The genome backend: browsers upload VCFs to it directly (tus), so it must be reachable.
// Keep in sync with DEFAULT_BACKEND_URL in app/genome-analysis/backend.ts.
const backendOrigin = new URL(
  process.env.CRISPR_API_URL ?? "https://148-100-79-183.sslip.io",
).origin;

// Next.js streams inline bootstrap scripts and next-themes sets the theme inline before
// paint, so scripts need 'unsafe-inline'; the 3D model's meshopt decoder compiles
// WebAssembly. Everything else is limited to this origin and the upload backend.
const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self' ${backendOrigin}`,
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
].join("; ");

/** @param {boolean} development */
const securityHeaders = (development) => [
  // The dev server uses eval and a websocket for hot reload, so the CSP is left out there.
  ...(development
    ? []
    : [{ key: "Content-Security-Policy", value: contentSecurityPolicy }]),
  {
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains",
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
];

/** @type {(phase: string) => import('next').NextConfig} */
const nextConfig = (phase) => ({
  devIndicators: false,
  poweredByHeader: false,
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
        source: "/:path*",
        headers: securityHeaders(phase === PHASE_DEVELOPMENT_SERVER),
      },
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
});

export default nextConfig;
