import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { Sections } from '@/components/sections'
import { findPage, pages } from '@/content/pages'

type Params = { params: Promise<{ path?: string[] }> }

function pathOf(segments: string[] | undefined): string {
  return `/${(segments ?? []).join('/')}`
}

export const dynamicParams = false

export function generateStaticParams() {
  return pages.map((page) => ({ path: page.path === '/' ? [] : page.path.slice(1).split('/') }))
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const page = findPage(pathOf((await params).path))
  if (!page) return {}
  return {
    title: page.meta.title ? { absolute: page.meta.title } : page.title,
    description: page.meta.description || undefined,
    alternates: { canonical: page.path },
    robots: page.meta.noindex ? { index: false } : undefined,
    openGraph: page.meta.ogImage ? { images: [{ url: page.meta.ogImage }] } : undefined,
  }
}

export default async function Page({ params }: Params) {
  const page = findPage(pathOf((await params).path))
  if (!page) notFound()
  return <Sections items={page.sections} />
}
