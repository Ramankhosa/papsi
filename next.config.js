/** @type {import('next').NextConfig} */
const nextConfig = {
  // Configure experimental features for better offline support
  experimental: {
    // Disable webpack build worker for offline development
    webpackBuildWorker: false,
  },

  // Configure headers to prevent external requests during development
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
        ],
      },
    ]
  },

  // Webpack configuration to handle offline scenarios
  webpack: (config, { dev }) => {
    if (dev) {
      // Disable external version checking in development
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
      }
    }
    return config
  },
}

module.exports = nextConfig

