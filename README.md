# WhatsFlow (working name)

Multi-tenant SaaS for businesses to send, receive, automate and analyze WhatsApp Business messages using only the official Meta WhatsApp Business Platform (Cloud API).

**Status:** Phases 1 to 3 of 10 are complete: accounts, workspaces, permissions, contact management, and connecting WhatsApp Business numbers through Meta's Embedded Signup with signed, deduplicated webhooks. Sending and receiving messages (inbox, templates) is Phase 4. See [the roadmap](docs/ROADMAP.md).

The product name and branding live in [`src/config/brand.ts`](src/config/brand.ts) and can be overridden with `NEXT_PUBLIC_BRAND_*` environment variables.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Database schema](docs/DATABASE.md)
- [Roadmap](docs/ROADMAP.md)
- [Phase 1 report](docs/phase-reports/PHASE-1.md)
- [Phase 2 report](docs/phase-reports/PHASE-2.md)
- [Phase 3 report](docs/phase-reports/PHASE-3.md)
- [Meta setup guide (platform owner)](docs/META_SETUP_GUIDE.md)
- [Meta API items requiring verification](docs/META_API_VERIFICATION.md)

## Requirements

- Node.js 22+
- Docker (for local PostgreSQL, Redis, MinIO and Mailpit), or your own PostgreSQL 16 and Redis 7

## Getting started

```bash
npm install                 # also generates the Prisma client
cp .env.example .env        # then set AUTH_SECRET (openssl rand -base64 48)
docker compose up -d        # postgres, redis, minio, mailpit
npm run db:migrate          # apply migrations to the dev database
npm run db:seed             # optional: demo workspace and users (development only)
npm run dev                 # http://localhost:3000
npm run worker              # in a second terminal: background jobs (webhook processing)
```

WhatsApp is optional in development. To enable it, follow [docs/META_SETUP_GUIDE.md](docs/META_SETUP_GUIDE.md) and set the `WHATSAPP_*` and `ENCRYPTION_KEY` values. Meta's sign-up window and webhooks need a public HTTPS address.

Emails sent in development (verification, password reset) are captured by Mailpit at http://localhost:8025.

### Demo data

`npm run db:seed` creates a workspace at `/w/demo`, clearly labeled "Demo data" in the UI, with 200 demo contacts, tags, a list, a custom field, a segment and four users (password `demo-password-123`):

| Role    | Email                    |
| ------- | ------------------------ |
| Owner   | owner@demo.example.com   |
| Admin   | admin@demo.example.com   |
| Agent   | agent@demo.example.com   |
| Analyst | analyst@demo.example.com |

The seed refuses to run when `NODE_ENV=production` unless `ALLOW_DEMO_SEED=true` is set.

## Scripts

| Command                           | What it does                                                            |
| --------------------------------- | ----------------------------------------------------------------------- |
| `npm run dev`                     | Start the dev server                                                    |
| `npm run build` / `npm start`     | Production build / start                                                |
| `npm run lint`                    | ESLint                                                                  |
| `npm run format` / `format:check` | Prettier                                                                |
| `npm run typecheck`               | Generate route types and run `tsc`                                      |
| `npm test`                        | Unit + integration tests (Vitest)                                       |
| `npm run test:unit`               | Unit tests only (no database needed)                                    |
| `npm run test:integration`        | Integration tests against `TEST_DATABASE_URL`                           |
| `npm run test:e2e`                | Playwright tests against a production build (run `npm run build` first) |
| `npm run db:migrate`              | Create/apply migrations in development                                  |
| `npm run db:deploy`               | Apply migrations (production/CI)                                        |
| `npm run db:seed`                 | Seed demo data                                                          |
| `npm run db:studio`               | Prisma Studio                                                           |

### Test databases

Integration tests use `TEST_DATABASE_URL` (default `whatsflow_test`) and E2E tests use `E2E_DATABASE_URL` (default `whatsflow_e2e`). Both are **emptied** by the test runs, and the runners refuse database names that do not contain `test`/`e2e`. `docker compose` creates both databases on first start.

E2E tests start their own SMTP sink on port 2525 and the app on port 3100.

## Docker

```bash
docker build -t whatsflow-web .
docker build --target worker -t whatsflow-worker .
docker run --env-file .env -p 3000:3000 whatsflow-web
docker run --env-file .env whatsflow-worker
```

Run `npx prisma migrate deploy` against the target database before starting a new version. The container exposes `/api/health` for health checks.
