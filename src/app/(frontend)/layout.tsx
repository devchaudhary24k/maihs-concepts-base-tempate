import React from 'react'
import './styles.css'
import { AiBuilderCommentBridge } from '@/components/ai-builder-comment-bridge'
import { TooltipProvider } from '@/components/ui/tooltip'

export const metadata = {
  description: 'A blank template using Payload in a Next.js app.',
  title: 'Payload Blank Template',
}

export default async function RootLayout(props: { children: React.ReactNode }) {
  const { children } = props

  return (
    <html lang="en">
      <body>
        <main>
          <TooltipProvider>{children}</TooltipProvider>
          <AiBuilderCommentBridge />
        </main>
      </body>
    </html>
  )
}
