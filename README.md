# Payload Cloudflare Template

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/payloadcms/payload/tree/3.x/templates/with-cloudflare-d1)

**This can only be deployed on Paid Workers right now due to size limits.** This template comes configured with the bare minimum to get started on anything you need.

## Quick start

This template can be deployed directly to Cloudflare Workers by clicking the button to take you to the setup screen.

From there you can connect your code to a git provider such Github or Gitlab, name your Workers, D1 Database and R2 Bucket as well as attach any additional environment variables or services you need.

## Quick Start - local setup

To spin up this template locally, follow these steps:

### Clone

After you click the `Deploy` button above, you'll want to have standalone copy of this repo on your machine. Cloudflare will connect your app to a git provider such as Github and you can access your code from there.

### Local Development

```bash
pnpm install
cp .env.example .env          # then set PAYLOAD_SECRET (see below)
pnpm dev                      # http://localhost:3000  (admin at /admin)
```

Wrangler provides a **local D1 (SQLite) + R2** binding automatically — no Cloudflare
login is needed for dev. The local D1 file lives at `.wrangler/state/...` and persists
across restarts.

The quality gate (kept green at all times):

```bash
pnpm lint && pnpm typecheck && pnpm build
```

## Environment variables

Copy `.env.example` to `.env`. For local dev, **only `PAYLOAD_SECRET` is required**.

### App variables (`process.env`)

| Variable | Required | Description |
| --- | --- | --- |
| `PAYLOAD_SECRET` | **Yes** | Payload JWT/encryption secret. Generate with `openssl rand -hex 32`. |
| `PAYLOAD_LOG_LEVEL` | No | `trace`\|`debug`\|`info`\|`warn`\|`error`\|`fatal`. Default `info`. |
| `CLOUDFLARE_ENV` | No | Selects a wrangler environment (e.g. `staging`). Unset = default. |

`NODE_ENV` and `NEXT_PHASE` are set automatically by the tooling — do not set them.

### Cloudflare bindings (not env vars)

Configured in `wrangler.jsonc`, injected by the Workers runtime (accessed via
`cloudflare.env.D1` / `cloudflare.env.R2`). In dev they are mocked locally by Wrangler —
no setup required. For production, see [Deployments](#deployments).

| Binding | `wrangler.jsonc` field | Production action |
| --- | --- | --- |
| `D1` | `database_id` (placeholder `DATABASE_ID`) | Replace with id from `wrangler d1 create <name>`. |
| `R2` | `bucket_name` | Create with `wrangler r2 bucket create <name>`. |
| `ASSETS` | — | Managed by OpenNext. |

### Deploy-only credentials

Needed only for `wrangler deploy` / remote migrations (never committed):

| Variable | Description |
| --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | Target Cloudflare account. |
| `CLOUDFLARE_API_TOKEN` | API token. Scopes: Workers Scripts:Edit, D1:Edit, R2:Edit, Account:Read. |

`PAYLOAD_SECRET` in production is stored as a Worker secret via `wrangler secret put PAYLOAD_SECRET`.

## Docker (dev container)

The `Dockerfile` builds a **dev-container image**: the repo + a warm `node_modules`,
ready to run `next dev` with a local D1. It is **not** a production artifact — production
runs on Cloudflare Workers.

```bash
docker build -t maihs-cms-template:dev .
docker run --rm -p 3000:3000 \
  -p 4000:4000 \
  -e AGENT_TOKEN=$(openssl rand -hex 32) \
  -e PAYLOAD_SECRET=$(openssl rand -hex 32) \
  -v maihs-d1:/app/.wrangler \
  maihs-cms-template:dev
```

- `PAYLOAD_SECRET` is injected at runtime (never baked into the image; `.env` is in `.dockerignore`).
- `AGENT_TOKEN` is required by the WebSocket daemon and is presented by clients via `Sec-WebSocket-Protocol: bearer.<token>`.
- Mount a volume at `/app/.wrangler` to persist the local D1 across container restarts.
- The default command starts the agent daemon as an unprivileged user. The daemon starts the dev server on `0.0.0.0:3000`, exposes WebSocket RPC on `/ws` at port `4000`, and reports container health when the agent port accepts connections.
- Override the command only for local debugging. Runtime file state expected to persist should live under mounted volumes such as `/app/.wrangler`.

### Docker image validation

```bash
pnpm validate:agent
docker build -t maihs-cms-template:dev .
docker run --rm -d --name maihs-template-smoke \
  -p 3000:3000 \
  -p 4000:4000 \
  -e AGENT_TOKEN=$(openssl rand -hex 32) \
  -e PAYLOAD_SECRET=$(openssl rand -hex 32) \
  maihs-cms-template:dev
docker exec maihs-template-smoke id
docker inspect --format='{{json .State.Health}}' maihs-template-smoke
docker rm -f maihs-template-smoke
```

## How it works

Out of the box, using [`Wrangler`](https://developers.cloudflare.com/workers/wrangler/) will automatically create local bindings for you to connect to the remote services and it can even create a local mock of the services you're using with Cloudflare.

We've pre-configured Payload for you with the following:

### Collections

See the [Collections](https://payloadcms.com/docs/configuration/collections) docs for details on how to extend this functionality.

- #### Users (Authentication)

  Users are auth-enabled collections that have access to the admin panel.

  For additional help, see the official [Auth Example](https://github.com/payloadcms/payload/tree/3.x/examples/auth) or the [Authentication](https://payloadcms.com/docs/authentication/overview#authentication-overview) docs.

- #### Media

  This is the uploads enabled collection.

### Image Storage (R2)

Images will be served from an R2 bucket which you can then further configure to use a CDN to serve for your frontend directly.

### D1 Database

The Worker will have direct access to a D1 SQLite database which Wrangler can connect locally to, just note that you won't have a connection string as you would typically with other providers.

You can enable read replicas by adding `readReplicas: 'first-primary'` in the DB adapter and then enabling it on your D1 Cloudflare dashboard. Read more about this feature on [our docs](https://payloadcms.com/docs/database/sqlite#d1-read-replicas).

## Working with Cloudflare

Firstly, after installing dependencies locally you need to authenticate with Wrangler by running:

```bash
pnpm wrangler login
```

This will take you to Cloudflare to login and then you can use the Wrangler CLI locally for anything, use `pnpm wrangler help` to see all available options.

Wrangler is pretty smart so it will automatically bind your services for local development just by running `pnpm dev`.

## Deployments

When you're ready to deploy, first make sure you have created your migrations:

```bash
pnpm payload migrate:create
```

Then run the following command:

```bash
pnpm run deploy
```

This will spin up Wrangler in `production` mode, run any created migrations, build the app and then deploy the bundle up to Cloudflare.

That's it! You can if you wish move these steps into your CI pipeline as well.

## Continuous Integration (Docker image → GHCR)

`.github/workflows/docker-publish.yml` builds the dev-container image and pushes it to
the GitHub Container Registry (GHCR) on every push to `main` (i.e. after a PR is merged —
it never runs on the PR itself).

Published tags:

```
ghcr.io/<owner>/<repo>:latest
ghcr.io/<owner>/<repo>:sha-<git-sha>
```

### GitHub setup required

1. **Workflow permissions** — Repo (or Org) → *Settings → Actions → General → Workflow
   permissions* → enable **Read and write permissions**. (The workflow also requests
   `packages: write` explicitly.)
2. **Org package policy** (org repos only) — *Org → Settings → Packages* → allow the
   `GITHUB_TOKEN` / Actions to create & publish container packages.
3. No secrets to add — authentication uses the built-in `GITHUB_TOKEN`.

### After the first publish

- The new package is **private** by default. To let machines pull anonymously:
  *Package → Settings → Change visibility → Public*.
- To pull privately instead, log in with a token that has `read:packages`:
  ```bash
  echo $GHCR_TOKEN | docker login ghcr.io -u <username> --password-stdin
  ```
- Pull the image (name is lowercase):
  ```bash
  docker pull ghcr.io/<owner>/<repo>:latest
  ```

## Enabling logs

By default logs are not enabled for your API, we've made this decision because it does run against your quota so we've left it opt-in. But you can easily enable logs in one click in the Cloudflare panel, [see docs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/#enable-workers-logs).

### Logger Configuration

This template includes a custom console-based logger compatible with Cloudflare Workers. Payload's default logger uses `pino-pretty`, which relies on Node.js APIs not available in Workers and would cause `fs.write is not implemented` errors.

The custom logger in `payload.config.ts`:

- Routes logs through `console.*` methods which Workers handles correctly
- Outputs JSON-formatted logs for Cloudflare observability
- Only active in production (development uses the default `pino-pretty` for better DX)

You can control the log level via the `PAYLOAD_LOG_LEVEL` environment variable (e.g., `debug`, `info`, `warn`, `error`).

### Diagnostic Channel Errors

If you see "Failed to publish diagnostic channel message" errors in your observability logs, these typically come from the `undici` HTTP client library. The template includes `skipSafeFetch: true` in the Media collection to use native fetch instead of undici for file uploads, which helps reduce these errors.

Cloudflare Workers runs in an [isolated environment that cannot access private IP ranges](https://developers.cloudflare.com/workers-vpc/examples/route-across-private-services/) by default, providing built-in SSRF protection. This makes `skipSafeFetch` safe to use.

## Known issues

### GraphQL

We are currently waiting on some issues with GraphQL to be [fixed upstream in Workers](https://github.com/cloudflare/workerd/issues/5175) so full support for GraphQL is not currently guaranteed when deployed.

### Worker size limits

We currently recommend deploying this template to the Paid Workers plan due to bundle [size limits](https://developers.cloudflare.com/workers/platform/limits/#worker-size) of 3mb. We're actively trying to reduce our bundle footprint over time to better meet this metric.

This also applies to your own code, in the case of importing a lot of libraries you may find yourself limited by the bundle.

## Questions

If you have any issues or questions, reach out to us on [Discord](https://discord.com/invite/payload) or start a [GitHub discussion](https://github.com/payloadcms/payload/discussions).
