import type { Metadata } from 'next'
import Link from 'next/link'
import type { ReactNode } from 'react'

import { AiBuilderCommentBridge } from '@/components/ai-builder-comment-bridge'
import { TooltipProvider } from '@/components/ui/tooltip'
import { site } from '@/content/site'

import './globals.css'

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: { default: site.name, template: `%s | ${site.name}` },
  manifest: '/site.webmanifest',
}

export default function SiteLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="nl">
      <body>
        <TooltipProvider>
          <header className="border-b">
            <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
              <Link href="/" className="font-semibold">
                {site.name}
              </Link>
              <ul className="flex gap-6 text-sm">
                {site.navigation.map((item) => (
                  <li key={item.href}>
                    <Link href={item.href}>{item.label}</Link>
                  </li>
                ))}
              </ul>
            </nav>
          </header>
          <main>{children}</main>
          <footer className="border-t">
            <div className="mx-auto max-w-6xl px-6 py-10 text-sm text-muted-foreground">
              © {new Date().getFullYear()} {site.name}
            </div>
          </footer>
        </TooltipProvider>
        <AiBuilderCommentBridge />
      </body>
    </html>
  )
}
