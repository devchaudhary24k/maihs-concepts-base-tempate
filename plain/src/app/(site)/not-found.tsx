import Link from 'next/link'

export default function NotFound() {
  return (
    <section className="mx-auto max-w-2xl px-6 py-32 text-center">
      <h1 className="text-3xl font-semibold">Pagina niet gevonden</h1>
      <p className="mt-4 text-muted-foreground">Deze pagina bestaat niet (meer).</p>
      <Link href="/" className="mt-8 inline-flex underline">
        Naar de homepage
      </Link>
    </section>
  )
}
