import type { NextConfig } from "next";

/**
 * The browser may only talk to this origin. `connect-src 'self'` covers
 * fetch, EventSource and WebSocket; the other directives close the remaining
 * ways a page could pull in or leak to a third party.
 *
 * Known limitation: `script-src 'unsafe-inline'` is required because Next.js
 * emits inline bootstrap scripts, and statically rendered pages cannot carry
 * a per-request nonce. Removing it would need hash-based CSP.
 */
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "media-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=()",
          },
        ],
      },
      // The icon never changes between deploys in practice; without this
      // Next serves it `max-age=0, must-revalidate`, i.e. one conditional
      // request on every page load.
      {
        source: "/icon.svg",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=86400, stale-while-revalidate=604800",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
