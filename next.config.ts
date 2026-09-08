import { withPayload } from '@payloadcms/next/withPayload'

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Generated concept sites must not be blocked from deploying by lint rules
  // (e.g. no-html-link-for-pages, no-unescaped-entities). Correctness is gated
  // upstream by the codegen ts_check; `next build` should only fail on real type
  // or compile errors, not style lint.
  eslint: {
    ignoreDuringBuilds: true,
  },
  // Concept images come from sources we cannot allowlist before a build runs:
  // files the builder writes into /public, generated images on our bucket, and
  // the client's own assets. The previous localPatterns entry admitted only
  // Payload's media route, so every other next/image src returned 400 from
  // /_next/image while the page still rendered 200. Keeping optimization would
  // need a wildcard remotePatterns, which is an open image proxy.
  images: {
    unoptimized: true,
  },
  // Packages with Cloudflare Workers (workerd) specific code
  // Read more: https://opennext.js.org/cloudflare/howtos/workerd
  serverExternalPackages: ['jose', 'pg-cloudflare'],

  // Your Next.js config here
  webpack: (webpackConfig: any) => {
    webpackConfig.resolve.extensionAlias = {
      '.cjs': ['.cts', '.cjs'],
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
      '.mjs': ['.mts', '.mjs'],
    }

    return webpackConfig
  },
}

export default withPayload(nextConfig, { devBundleServerPackages: false })
