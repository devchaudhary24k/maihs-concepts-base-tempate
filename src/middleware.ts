import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const LOCAL_HOST = /^(localhost|0\.0\.0\.0|127\.|\[|\d+\.\d+\.\d+\.\d+)/

/**
 * Redirects http to https in production only.
 *
 * SE Ranking submits a bare domain and follows redirects from there. Without
 * this the crawler lands on http, stays there, and books "No HTTPS encryption"
 * as an error even though the site is reachable over https.
 *
 * Two guards keep it away from the dev preview. Next's dev server sets
 * `x-forwarded-proto: http` on every incoming request by itself, so that header
 * alone is no proof a proxy sits in front. And the host inside the container is
 * `0.0.0.0:3000`; switching only the protocol redirects to an address where
 * nothing listens, which makes the preview unreachable.
 */
export function middleware(request: NextRequest) {
  if (process.env.NODE_ENV !== 'production') return NextResponse.next()
  const host = (request.headers.get('host') ?? '').split(',')[0].trim()
  if (!host.includes('.') || LOCAL_HOST.test(host)) return NextResponse.next()
  const forwarded = request.headers.get('x-forwarded-proto')
  if (forwarded && forwarded.split(',')[0].trim() === 'http') {
    const target = new URL(request.url)
    target.protocol = 'https:'
    target.host = host
    return NextResponse.redirect(target, 301)
  }
  return NextResponse.next()
}

export const config = {
  matcher: '/((?!_next/static|_next/image|favicon.ico|admin|api).*)',
}
