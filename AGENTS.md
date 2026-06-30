# AGENTS.md

Guidance for Codex and other coding agents in this repository.

## Package Manager

- Use `pnpm` only.
- Do not run `npm`, `npx`, `yarn`, `bun`, `bunx`, `pnpx`, or equivalents.
- Keep `packageManager` as `pnpm@10.33.0`.
- Do not globally approve dependency lifecycle scripts.

## Commands

```bash
pnpm dev
pnpm build
pnpm preview
pnpm deploy
pnpm typecheck
pnpm fulfillment:dev
pnpm fulfillment:typecheck
pnpm lint
pnpm test:run
pnpm test:coverage
pnpm test:e2e -- --project=public
pnpm test:e2e -- --project=student
pnpm test:e2e -- --project=teacher
pnpm test:e2e -- --project=admin
pnpm db:seed
pnpm secrets:check
pnpm launch:rc
pnpm launch:gate
```

## Architecture

Espanol Honesto is an Astro 5 SSR app deployed to Cloudflare Pages with a separate Cloudflare Worker for Google Workspace and Resend jobs.

Cloudflare Pages:

- Public web and blog.
- Campus student/teacher/admin.
- API routes for auth, checkout, Stripe webhook, scheduling and admin CRM.
- Enqueues `fulfillment_jobs`.
- Delegates Google/Resend work to the Cloudflare Fulfillment Worker.

Cloudflare Fulfillment Worker:

- Package: `workers/fulfillment`.
- Uses Google SDKs and Resend.
- Processes jobs from `src/lib/fulfillment/jobs.ts`.
- Exposes internal endpoints protected by `INTERNAL_JOB_SECRET`.

Runtime boundary:

- `src/pages/api/**` must not import `src/lib/google/**`.
- `src/pages/api/**` must not import `src/lib/fulfillment/jobs.ts`.
- Cloudflare-safe queue helpers live in `src/lib/fulfillment/queue.ts`.
- Cloudflare Pages-to-Worker client lives in `src/lib/internal-job-service.ts`.

## Database

- Official schema source: `db/schema.sql`.
- Apply deployment SQL from `supabase/migrations/`.
- Key tables: `profiles`, `packages`, `subscriptions`, `sessions`, `student_teachers`, `payments`, `leads`, `profiles_private`, `processed_webhook_events`, `fulfillment_jobs`, `admin_audit_log`.
- `src/lib/supabase-admin.ts` uses service role and bypasses RLS. Server-only.

## Product Rules

- Runtime product source: Supabase `packages`.
- Admin CRM: `/es/campus/admin/packages`.
- Price/quota changes affect only new purchases.
- Stripe prices are immutable; changing package price clears stored Price IDs until Stripe is synchronized.
- Admin recovery UI for jobs: `/es/campus/admin/jobs`.
- Supported class durations are 30, 40 and 50 minutes. The default class duration is 50 minutes. Google Meet is not cut off automatically.

## Google Decisions

- Keep service account with domain-wide delegation.
- Keep Drive "anyone with link can view" as the current operational model.
- Students may link a Google account, but public-link access is not revoked automatically while this decision remains active.

## Environment Variables

Required runtime groups:

- Supabase: `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- Stripe: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `PUBLIC_STRIPE_PUBLISHABLE_KEY`
- Cloudflare fulfillment Worker: `FULFILLMENT_WORKER_URL`, `INTERNAL_JOB_SECRET`
- Google, only the fulfillment Worker: `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`, `GOOGLE_ADMIN_EMAIL`, `GOOGLE_DRIVE_ROOT_FOLDER_ID`, `GOOGLE_TEMPLATE_DOC_ID`
- Email: `RESEND_API_KEY`, `EMAIL_FROM`, optional `SUPPORT_ALERT_EMAIL`
- Turnstile: `PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`
- Sentry: `PUBLIC_SENTRY_DSN`, `SENTRY_AUTH_TOKEN`
- Cron: `CRON_SECRET`

Do not print or commit real secret values.

## Testing Notes

- Vitest tests use dynamic imports after mocks.
- Playwright auth state is stored in `tests/e2e/.auth/` and is git-ignored.
- `.env.test` controls test users.
- Set `E2E_DISABLE_EXTERNAL_INTEGRATIONS=true` for local booking E2E tests that should not call Google/Resend.

## Documentation

Current sources:

- `README.md`
- `ARCHITECTURE.md`
- `docs/launch/DECISIONS.md`
- `docs/launch/ENVIRONMENT.md`
- `docs/launch/PRODUCTS.md`
- `docs/launch/RUNBOOK.md`
- `docs/launch/CHECKLIST.md`

Historical audit docs were intentionally removed. Do not recreate stale parallel status docs.
