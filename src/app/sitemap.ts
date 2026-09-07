import type { MetadataRoute } from 'next'
import { headers } from 'next/headers'

export const dynamic = 'force-dynamic'

/**
 * Every crawlable route on this site.
 *
 * Keep this list in sync when you add or remove a page. In-page anchors do not
 * belong here: they are not separate URLs, and a sitemap that promises them is
 * marked down for it.
 */
const ROUTES = ['/']

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const host = (await headers()).get('host') ?? ''
  if (!host) return []
  return ROUTES.map((route) => ({ url: `https://${host}${route}`, lastModified: new Date() }))
}
