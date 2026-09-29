import Image from 'next/image'
import Link from 'next/link'

export interface HeroProps {
  title: string
  intro: string
  image: { src: string; alt: string } | null
  primaryAction: { label: string; href: string } | null
}

export function Hero({ title, intro, image, primaryAction }: HeroProps) {
  return (
    <section className="mx-auto grid max-w-6xl gap-10 px-6 py-24 md:grid-cols-2 md:items-center">
      <div className="space-y-6">
        <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">{title}</h1>
        {intro ? <p className="text-lg text-muted-foreground">{intro}</p> : null}
        {primaryAction ? (
          <Link href={primaryAction.href} className="inline-flex rounded-md bg-primary px-5 py-3 text-primary-foreground">
            {primaryAction.label}
          </Link>
        ) : null}
      </div>
      {image ? <Image src={image.src} alt={image.alt} width={960} height={720} className="rounded-xl object-cover" priority /> : null}
    </section>
  )
}
