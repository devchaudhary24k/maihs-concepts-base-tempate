import type { MetadataRoute } from 'next'

import { pages } from '@/content/pages'
import { site } from '@/content/site'

export default function sitemap(): MetadataRoute.Sitemap {
  return pages
    .filter((page) => !page.meta.noindex)
    .map((page) => ({ url: `${site.url}${page.path === '/' ? '' : page.path}`, lastModified: new Date() }))
}
