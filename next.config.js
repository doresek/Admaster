/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['@anthropic-ai/sdk'],
  },
  images: {
    domains: ['graph.facebook.com', 'scontent.cdninstagram.com'],
  },
};

module.exports = nextConfig;
