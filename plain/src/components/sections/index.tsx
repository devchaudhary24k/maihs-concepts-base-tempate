import type { SectionData } from '@/content/types'

import { Hero } from './hero'

export const sections = {
  hero: Hero,
}

export function Sections({ items }: { items: SectionData[] }) {
  return (
    <>
      {items.map((section, index) => {
        const { type, id, ...props } = section
        const Component = sections[type] as unknown as (props: Record<string, unknown>) => React.ReactNode
        return <Component key={id ?? `${type}-${index}`} {...props} />
      })}
    </>
  )
}
