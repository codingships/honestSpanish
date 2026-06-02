---
artifact: launch-environment
version: "1.0"
created: 2026-05-29
status: draft
updated: 2026-05-29
---

# Environment Variables

This document lists launch environment variables by purpose. Do not commit real secret values.

## Site URL

Preferred:

- `PUBLIC_SITE_URL`

Backward-compatible aliases accepted by code:

- `PUBLIC_URL`
- `SITE`

Usage:
- Stripe Checkout success/cancel URLs.
- Stripe Customer Portal return URL.
- Welcome email login URL.

Production value:

- `https://espanolhonesto.com`

## Supabase

- `PUBLIC_SUPABASE_URL`
- `PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

Notes:
- Service role key is server-only and bypasses RLS.
- Never expose service role key to client code.
- The service role key is not enough to apply schema migrations, create tables, or change RLS policies.

## Supabase Direct Database Access

Operational variable, not used by the app runtime:

- `SUPABASE_DB_URL`

Usage:
- Apply SQL migrations with `psql`.
- Verify database DDL, RLS policies, and privileged tables.

Notes:
- This must be a direct Postgres connection string for the Supabase project.
- Do not expose it to client code or commit it.
- Without this, migrations such as `supabase/migrations/009_launch_catalog_and_fulfillment.sql` must be applied manually through Supabase SQL Editor.

## Stripe

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `PUBLIC_STRIPE_PUBLISHABLE_KEY`

Notes:
- Keep test and live mode values separate.
- Stripe price IDs must match active DB packages.

## Google Workspace

- `GOOGLE_SERVICE_ACCOUNT_EMAIL`
- `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`
- `GOOGLE_ADMIN_EMAIL`
- `GOOGLE_DRIVE_ROOT_FOLDER_ID`
- `GOOGLE_TEMPLATE_DOC_ID`

Notes:
- Uses Service Account with Domain-Wide Delegation.
- `GOOGLE_ADMIN_EMAIL` is the impersonated account.
- Delegated scopes must be reviewed before launch.

## Email

- `RESEND_API_KEY`
- `EMAIL_FROM`

Backward-compatible alias accepted by code:

- `RESEND_FROM_EMAIL`

Optional:

- `ADMIN_EMAIL`

Usage:
- Transactional class emails.
- Lead notifications.
- Welcome emails.

## Turnstile

- `PUBLIC_TURNSTILE_SITE_KEY`
- `TURNSTILE_SECRET_KEY`

Usage:
- Lead capture anti-bot validation.

## Cron

- `CRON_SECRET`

Main app:
- Required by `/api/cron/send-reminders`.
- Required by `/api/cron/process-fulfillment`.

Reminder worker:
- Must match the main app value.
- Also requires `APP_URL`, usually `https://espanolhonesto.com`.

## Sentry

- `PUBLIC_SENTRY_DSN`
- `SENTRY_DSN`
- `SENTRY_ORG`
- `SENTRY_PROJECT`
- `SENTRY_AUTH_TOKEN`

Notes:
- Runtime DSN can use `PUBLIC_SENTRY_DSN` or `SENTRY_DSN`.
- Source map upload requires org, project, and auth token.

## Local Test Variables

- `TEST_BASE_URL`
- `TEST_STUDENT_EMAIL`
- `TEST_STUDENT_PASSWORD`
- `TEST_TEACHER_EMAIL`
- `TEST_TEACHER_PASSWORD`
- `TEST_ADMIN_EMAIL`
- `TEST_ADMIN_PASSWORD`
- `E2E_DISABLE_EXTERNAL_INTEGRATIONS`

Notes:
- E2E tests can write to real services if configured against real env values.
- Confirm target environment before running E2E or smoke scripts.
- Set `E2E_DISABLE_EXTERNAL_INTEGRATIONS=true` in `.env.test` to skip Google/Resend side effects during local Playwright booking tests. Code ignores this flag in production.
