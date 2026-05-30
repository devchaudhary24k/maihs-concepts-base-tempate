import fs from 'fs'
import path from 'path'
import { sqliteD1Adapter } from '@payloadcms/db-d1-sqlite'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { buildConfig } from 'payload'
import { fileURLToPath } from 'url'
import { CloudflareContext, getCloudflareContext } from '@opennextjs/cloudflare'
import { GetPlatformProxyOptions } from 'wrangler'
import { r2Storage } from '@payloadcms/storage-r2'

import { Users } from './collections/Users'
import { Media } from './collections/Media'
import { migrations } from './migrations'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)
const realpath = (value: string) => (fs.existsSync(value) ? fs.realpathSync(value) : undefined)

const isCLI = process.argv.some((value) => realpath(value)?.endsWith(path.join('payload', 'bin.js')))
const isProduction = process.env.NODE_ENV === 'production'
// `next build` runs in this phase. During build we must use LOCAL wrangler bindings
// (Miniflare) — remote bindings would require a Cloudflare login and break offline builds.
const isBuild = process.env.NEXT_PHASE === 'phase-production-build'

const createLog =
  (level: string, fn: typeof console.log) => (objOrMsg: object | string, msg?: string) => {
    if (typeof objOrMsg === 'string') {
      fn(JSON.stringify({ level, msg: objOrMsg }))
    } else {
      fn(JSON.stringify({ level, ...objOrMsg, msg: msg ?? (objOrMsg as { msg?: string }).msg }))
    }
  }

const cloudflareLogger = {
  level: process.env.PAYLOAD_LOG_LEVEL || 'info',
  trace: createLog('trace', console.debug),
  debug: createLog('debug', console.debug),
  info: createLog('info', console.log),
  warn: createLog('warn', console.warn),
  error: createLog('error', console.error),
  fatal: createLog('fatal', console.error),
  silent: () => {},
} as any // Use PayloadLogger type when it's exported

// Use the local wrangler proxy for: the Payload CLI (migrations/seed), `next dev`,
// and `next build`. Only the deployed Worker runtime uses the injected context.
const cloudflare =
  isCLI || !isProduction || isBuild
    ? await getCloudflareContextFromWrangler()
    : await getCloudflareContext({ async: true })

export default buildConfig({
  admin: {
    user: Users.slug,
    importMap: {
      baseDir: path.resolve(dirname),
    },
  },
  collections: [Users, Media],
  editor: lexicalEditor(),
  secret: process.env.PAYLOAD_SECRET || '',
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
  db: sqliteD1Adapter({
    binding: cloudflare.env.D1,
    prodMigrations: migrations,
  }),
  logger: isProduction ? cloudflareLogger : undefined,
  plugins: [
    // R2 is optional: when the worker is deployed without an R2 binding (the
    // `wrangler.jsonc` `r2_buckets` entry stripped at deploy time), `cloudflare.env.R2`
    // is undefined in every phase (next build, opennext build, worker runtime). Guard
    // the storage plugin so a no-R2 deploy builds and boots — media uploads are then
    // disabled, reads and the rest of the app are unaffected.
    ...(cloudflare.env.R2
      ? [
          r2Storage({
            bucket: cloudflare.env.R2,
            collections: { media: true },
          }),
        ]
      : []),
  ],
})

// Adapted from https://github.com/opennextjs/opennextjs-cloudflare/blob/d00b3a13e42e65aad76fba41774815726422cc39/packages/cloudflare/src/api/cloudflare-context.ts#L328C36-L328C46
function getCloudflareContextFromWrangler(): Promise<CloudflareContext> {
  return import(/* webpackIgnore: true */ `${'__wrangler'.replaceAll('_', '')}`).then(
    ({ getPlatformProxy }) =>
      getPlatformProxy({
        environment: process.env.CLOUDFLARE_ENV,
        // Remote bindings only for the deploy-time CLI (e.g. `payload migrate` against
        // real D1). Local dev and `next build` use the local Miniflare D1 file.
        remoteBindings: isProduction && !isBuild,
      } satisfies GetPlatformProxyOptions),
  )
}
