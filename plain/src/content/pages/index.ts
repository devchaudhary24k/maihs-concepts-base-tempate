import type { PageContent } from '../types'
import { home } from './home'

export const pages: PageContent[] = [home]

export function findPage(path: string): PageContent | undefined {
  return pages.find((page) => page.path === path)
}
