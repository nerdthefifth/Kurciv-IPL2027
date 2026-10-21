# Deployment

Kurciv runs as a single Node.js process that serves the API and the built web app, with SQLite on local disk.

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8787` | HTTP port |
| `KURCIV_DB` | `./data/kurciv.db` | SQLite file (WAL mode). Put it on persistent storage. |
| `NODE_ENV` | — | `production` adds the `Secure` flag to session cookies (serve over HTTPS) |
| `TRUST_PROXY` | `0` | Set to `1` behind a reverse proxy so per-IP rate limiting sees real client IPs |
| `KURCIV_IMAGE_MANIFEST` | — | Optional licensed-portrait manifest (see DATA_SOURCES.md) |

See `.env.example`. No secrets are required. Session tokens are random, stored server-side and sent as httpOnly, SameSite=Lax cookies.

## Single server (VM, container, PaaS with a volume)

```bash
npm ci
npm run build
NODE_ENV=production KURCIV_DB=/var/lib/kurciv/kurciv.db PORT=8787 npm start
```

Put it behind a TLS-terminating reverse proxy (Caddy, nginx, or the platform router) and set `TRUST_PROXY=1`. Health check: `GET /healthz`.

Minimal Dockerfile:

```dockerfile
FROM node:22-slim
WORKDIR /app
COPY . .
RUN npm ci && npm run build
ENV NODE_ENV=production KURCIV_DB=/data/kurciv.db PORT=8787 TRUST_PROXY=1
VOLUME /data
EXPOSE 8787
CMD ["npm", "start"]
```

## Backups

SQLite in WAL mode can be backed up live with `sqlite3 kurciv.db ".backup backup.db"`, or by copying the file while the server is stopped. Everything is gzip-compressed. A career's world state is about 0.2 MB, and full ball-by-ball records of every match in the world add roughly 11–12 MB per career-season (about 520 matches at around 22 KB each).

## Scaling beyond one process

The server keeps a small in-memory cache of recently used careers and serialises mutations per career in-process. To run several instances:

1. Move persistence to PostgreSQL using the mapping in [DATABASE.md](DATABASE.md). The optimistic `version` check already protects against concurrent writers; keep it.
2. Route each career to one instance (sticky by career ID), or remove the cache and rely on the version check alone.
3. Replace local accounts (`apps/server/src/auth.ts`) with an established identity provider (OIDC). The rest of the server only reads `req.userId`.
4. Move long-running season simulation to a job queue (e.g. Redis-backed) if request timeouts become a problem. A full world season takes about 10–20 s of CPU.

## Security checklist

- All inputs are validated with zod; request bodies are capped at 256 KB.
- Every career route checks ownership; foreign IDs return 404.
- Auth endpoints are rate-limited (20 requests per minute per IP).
- `X-Content-Type-Options`, `X-Frame-Options: DENY` and `Referrer-Policy` headers are set.
- No API keys are shipped to the browser. The client can never submit match outcomes, only decisions.
