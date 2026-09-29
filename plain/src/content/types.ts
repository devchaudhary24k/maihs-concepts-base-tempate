import type { ComponentProps } from 'react'

import type { sections } from '@/components/sections'

type SectionRegistry = typeof sections

export type SectionData = {
  [Type in keyof SectionRegistry]: { type: Type; id?: string } & ComponentProps<SectionRegistry[Type]>
}[keyof SectionRegistry]

export interface PageMeta {
  title?: string
  description?: string
  ogImage?: string
  noindex?: boolean
}

export interface PageContent {
  path: string
  title: string
  meta: PageMeta
  sections: SectionData[]
}

export interface NavigationItem {
  label: string
  href: string
  children?: NavigationItem[]
}

export interface SiteContent {
  name: string
  url: string
  tagline: string
  contact: {
    phone: string
    email: string
    address: string
    postcode: string
    city: string
  }
  navigation: NavigationItem[]
  footerNavigation: NavigationItem[]
}
