# SAINT — Supplier Management Module

Supplier master data, W-9 intake with OCR extraction, and market-risk monitoring for the
SAINT Source-to-Procure platform.

## What it does

| Capability | How |
|---|---|
| Manual supplier entry | Validated form (Zod) → `POST /api/suppliers` |
| W-9 upload + data extraction | S3 archive → **Amazon Textract** `AnalyzeDocument` (FORMS) → field mapper auto-fills the form |
| Public / Private classification | Radio selector; ticker symbol captured for listed companies |
| 10 most recent records on screen | Server-rendered table with expandable detail |
| Weekly / monthly market news | Pluggable news provider → keyword risk classifier → digest written into the supplier's Market News field |
| M&A / bankruptcy / dispute alerts | Classifier raises a `risk_alert`, emails the procurement manager via Amazon SES |

## Architecture

```
Browser
   │
   ▼
Next.js 15 (App Router)  ──►  AWS App Runner (container from ECR)
   │  server components + route handlers
   │
   ├──► Drizzle ORM ──► Amazon RDS for PostgreSQL   (supplier master, news, alerts)
   ├──► Amazon Textract                             (W-9 field extraction)
   ├──► Amazon S3                                   (W-9 archive, SSE-AES256)
   ├──► Amazon SES                                  (risk alert email)
   └──► News provider (mock | NewsAPI | RSS)        (market intelligence)
```

**Why this stack:** one deployable unit, no separate API server to operate. Drizzle is a
thin, fully type-safe SQL layer with no engine binary, so the container image stays small
and cold starts stay fast. Everything runs on managed AWS services — no servers to patch.

## Local development

```bash
cp .env.example .env
docker compose up -d          # Postgres 16 on :5432
npm install
npm run db:migrate            # apply SQL migrations
npm run db:seed               # 10 demo suppliers
npm run dev                   # http://localhost:3000
```

Textract and SES calls need AWS credentials. Without them the app still runs — W-9
extraction returns a clear error and alerts are logged instead of emailed.

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | Production build (standalone output) |
| `npm run db:generate` | Generate a new SQL migration after editing `src/db/schema.ts` |
| `npm run db:migrate` | Apply migrations |
| `npm run db:push` | Push schema without a migration file (dev only) |
| `npm run db:seed` | Insert 10 demo suppliers |
| `npm run db:studio` | Drizzle Studio |
| `npm run typecheck` | `tsc --noEmit` |

## API

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/api/suppliers?limit=10&q=&companyType=` | List suppliers (tax IDs masked) |
| `POST` | `/api/suppliers` | Create supplier |
| `GET` `PATCH` `DELETE` | `/api/suppliers/[id]` | Read / update / delete |
| `POST` | `/api/w9/extract` | multipart `file` → Textract → mapped W-9 fields |
| `POST` | `/api/news/preview` | Fetch + classify news for an unsaved company |
| `POST` | `/api/news/refresh` | `{supplierId}` one supplier, or `{cadence}` batch (Bearer `CRON_SECRET`) |
| `GET` `PATCH` | `/api/alerts` | List / update risk alerts |
| `GET` | `/api/health` | App Runner health check |

## Data model

`suppliers` → `w9_documents`, `market_news_items`, `risk_alerts` (all cascade on delete).
Schema lives in `src/db/schema.ts`; migrations in `drizzle/`.

## Swapping the news provider

`src/lib/news/providers.ts` exposes a `NewsProvider` interface. Set `NEWS_PROVIDER`:

- `mock` (default) — deterministic demo feed, no key required
- `newsapi` — set `NEWS_API_KEY`
- `rss` — set `NEWS_RSS_TEMPLATE` (e.g. Google News RSS)

Classification lives separately in `src/lib/news/classifier.ts`, so you can later replace
the keyword rules with an LLM call without touching the providers.

## Deployment

See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for the full AWS + GitHub walkthrough.

## Security notes

- Tax IDs are never serialized to the browser — the server sends only a masked form.
- W-9 objects are written to S3 with SSE and are only retrievable via short-lived presigned URLs.
- No AWS keys in the container: App Runner supplies credentials through an instance role.
- There is no authentication layer yet — put the service behind Cognito, an ALB with OIDC,
  or your existing SSO before exposing it beyond a private network.
