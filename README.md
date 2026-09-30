# MAIHS concept base images

This repository builds the Docker images the MAIHS AI builder starts concept workspaces from. Each folder holds one image. Its Dockerfile copies that folder into `/app`, together with the shared agent daemon in `.agent/`.

| Folder     | Image tag                  | What a container starts with                                                                                        |
| ---------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `payload/` | `:latest` and `:payload`   | The Payload CMS template on Cloudflare D1 and R2. Existing concepts run on this one.                                |
| `plain/`   | `:plain`                   | A Next.js site with its content in typed files and no database. The dashboard package is added later, per site.    |
| `import/`  | `:import-runtime`          | An empty `/app` with Node, Python and the agent daemon. MAIHS clones an existing site repository into it.           |

A push to `main` publishes all three to `ghcr.io`. The MAIHS server pulls a new image only when someone runs `docker pull` there.

Build one locally from the repository root, because every image needs `.agent/`:

```bash
docker build -f plain/Dockerfile -t maihs-concept:plain .
```

Change a template inside its own folder. `.agent/server.mjs` is shared, so a change there reaches every image.
