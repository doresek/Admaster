// Content-Security-Policy — defense-in-depth for the public landing pages
// (finding S2). The allow-listed `frame-src` plus the URL sanitizers in
// lib/safe-url.ts are the core fix; this CSP blocks the residual
// `javascript:` / `data:text/html` / cross-origin-iframe vectors at the
// browser level. `'unsafe-inline'` is retained for script/style because the
// app relies on styled-jsx (<style jsx global>) and inline event/style attrs.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  // connect-src MUST allow cross-origin XHR/fetch/WebSocket, or the browser Supabase
  // client (auth login, realtime) and other https APIs are blocked → "Failed to fetch"
  // on login. Without this directive it falls back to default-src 'self' and breaks auth.
  "connect-src 'self' https: wss:",
  "frame-src https://www.youtube.com https://youtube.com https://youtube-nocookie.com https://player.vimeo.com https://vimeo.com",
  "img-src 'self' data: https:",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'self'",
].join('; ');

/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['@anthropic-ai/sdk'],
  },
  images: {
    domains: ['graph.facebook.com', 'scontent.cdninstagram.com'],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: CSP },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
