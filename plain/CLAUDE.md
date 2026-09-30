# Site template

A plain Next.js 16 website, built by the MAIHS AI builder and deployed to Cloudflare Workers with OpenNext. It has no database and no dashboard. A dashboard can be added later with `@mhs-media-software/site-kit`; the rules below keep that step mechanical.

## Content lives in `src/content`, never in components

- Every page is a `PageContent` object in `src/content/pages/<name>.ts`, listed in `src/content/pages/index.ts`. The catch-all route `src/app/(site)/[[...path]]/page.tsx` renders it; do not add a route file per page.
- A page is a list of sections. A section is a component in `src/components/sections/<name>.tsx`, registered in `src/components/sections/index.tsx`, that renders only from its props.
- Put every piece of copy, every image and every link in the page's content object. A section component holds layout and styling, not text.
- Props stay plain data: strings, numbers, booleans, `{ src, alt }` images, `{ label, href }` links, and arrays or objects of those. Rich text is a string of simple HTML (p, h2, h3, strong, em, a, ul, ol, li).
- Business details, navigation and footer links live in `src/content/site.ts`.

A bespoke route (for example an interactive calculator) is fine when a section cannot express it; keep its copy in `src/content` too.

## Stack

- Next.js 16 App Router, React 19, Tailwind CSS 4, shadcn/ui components in `src/components/ui`.
- `src/proxy.ts` redirects http to https in production.
- Images are served unoptimised (`images.unoptimized`), so size them before use.
- Deploy: `pnpm run deploy:build` builds the Worker; MAIHS uploads it with wrangler.
- `maihs.json` tells MAIHS what this site needs at deploy time. It says no database, no storage and no scheduled jobs.
