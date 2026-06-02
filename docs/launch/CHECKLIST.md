---
artifact: launch-checklist
version: "1.0"
created: 2026-05-29
status: draft
updated: 2026-05-29
---

# Launch Checklist: Español Honesto

## Launch Overview

| Field | Value |
|---|---|
| What | Real launch of the multilingual online Spanish academy platform |
| Launch Date | TBD |
| Launch Type | Major release |
| Launch Owner | Alin |
| Go/No-Go Decision Maker | Alin |

## Engineering Readiness

| Item | Owner | Status | Notes |
|---|---|---|---|
| Build passes with production config | Engineering | Done | `pnpm build` passed on 2026-05-29 |
| Typecheck passes | Engineering | Done | `pnpm run typecheck` passed on 2026-05-29 |
| Lint passes | Engineering | Done | `pnpm run lint` passed on 2026-05-29 |
| Unit/API tests pass | Engineering | Done | `pnpm run test:run` passed on 2026-05-29 |
| Public/student/teacher/admin E2E pass | Engineering | Done | 43 Playwright tests passed on 2026-05-29 after preparing E2E users |
| Cloudflare Pages deploy verified | Engineering | Open | Confirm deployed branch and env vars |
| Reminder worker deploy verified | Engineering | Open | Confirm `APP_URL` and `CRON_SECRET` |
| Google/Email processing is reliable | Engineering | Implemented/Pending Deploy | Persistent `fulfillment_jobs` + `waitUntil`; apply migration and verify in production |
| Stripe webhook idempotency and retry behavior reviewed | Engineering | Open | Avoid silent missing fulfillment |
| Authenticated checkout smoke verified | Engineering | Done/Test Mode | `pnpm exec tsx scripts/smoke-checkout.ts` created a Stripe test Checkout Session on 2026-05-29 |
| Supabase RLS and privileged tables reviewed | Engineering | Open | Include `processed_webhook_events` hardening |
| Admin package CRM available | Engineering | Implemented/Pending Deploy | `/es/campus/admin/packages` verified locally; audit logging still requires migration 009 |

## Product And Commercial Readiness

| Item | Owner | Status | Notes |
|---|---|---|---|
| Package names, quotas, prices decided | Product | Done/Pending Copy Review | `group`, `standard`, `hybrid`, `bootcamp`; see `PRODUCTS.md` |
| Stripe prices match product decision | Product/Engineering | Done/Test Mode | Active packages synced to Stripe test mode and Supabase on 2026-05-29 |
| Live Stripe mode verified | Product/Engineering | Open | Repeat/verify synchronization with intended live Stripe keys before paid launch |
| Public pricing copy matches quotas | Product | Open | All languages; checkout disabled until Stripe IDs exist |
| Registration/payment flow accepted | Product | Pending | Current recommendation: keep registration before payment |
| Support process for students without Google account | Operations | Open | Current decision: allow Drive link first |

## Legal And Compliance

| Item | Owner | Status | Notes |
|---|---|---|---|
| Legal owner identity filled | Legal/Product | Blocker | Current pages still contain placeholders |
| Privacy policy reviewed | Legal/Product | Open | Must mention Stripe, Supabase, Google, Resend, Sentry if used |
| Cookie policy reviewed | Legal/Product | Open | No analytics unless consent flow exists |
| Terms/conditions for subscriptions and cancellations reviewed | Legal/Product | Open | Needed for paid launch |
| DPA/vendor transfer position reviewed | Legal/Product | Open | Google/Stripe/Supabase/Resend/Sentry |

## Operations And Support

| Item | Owner | Status | Notes |
|---|---|---|---|
| Admin runbook exists | Operations | Draft | See `RUNBOOK.md` |
| Incident path defined | Operations | Open | Payments, no Meet link, no Drive folder, email failure |
| Backup/restore posture known | Operations | Open | Supabase backups and Google Drive ownership |
| Sentry alerts configured | Operations | Open | Requires env alignment |
| Smoke test plan exists | Engineering | Open | Do not run against real services without confirmation |

## SEO And Marketing

| Item | Owner | Status | Notes |
|---|---|---|---|
| Sitemap/robots verified | Marketing/Engineering | Open | Confirm canonical sitemap |
| Canonical/hreflang reviewed | Marketing/Engineering | Open | Multilingual launch |
| Public copy reviewed in ES/EN/RU | Marketing | Open | Product and legal copy included |
| Analytics strategy decided | Marketing | Open | No analytics cookies currently declared |
| Lead magnet flow verified | Marketing/Engineering | Open | Turnstile + Resend + leads table |

## Go/No-Go Criteria

### Must Have

- [ ] `pnpm build`, `pnpm run typecheck`, `pnpm run lint`, and agreed test suite are green.
- [ ] Product prices/quotas/copy are reconciled across docs, DB, Stripe, and UI.
- [ ] Legal placeholders are replaced and reviewed.
- [ ] A paid user can register, pay, receive subscription, book a class, receive Meet/Doc/Drive links, and get reminders.
- [ ] Fulfillment jobs process welcome and session work successfully.
- [ ] Admin can recover from failed Drive, Calendar, Stripe webhook, or email fulfillment.
- [ ] Production Cloudflare/Supabase/Stripe/Google/Resend/Sentry env vars are verified.

### Should Have

- [ ] Smoke test script documented and safe to run.
- [ ] Sentry alerts configured for API/webhook/cron failures.
- [ ] Old audit docs archived or clearly marked stale.

### Nice To Have

- [ ] Conversion analytics after a consent strategy is decided.
- [ ] Code-splitting for the large Keystatic chunk.
- [ ] Expanded accessibility pass.

## Rollback Plan

Rollback triggers:

- Payments succeed but subscriptions are not provisioned.
- Bookings succeed but Google/Email fulfillment fails repeatedly.
- Auth or role boundary issue is discovered.
- Production deploy breaks public pricing or login.

Rollback steps:

1. Disable public purchase entry points or set packages inactive.
2. Revert Cloudflare Pages to previous deployment.
3. Pause reminder worker if it sends incorrect emails.
4. Manually reconcile Stripe/Supabase records for affected users.
5. Communicate with affected users using the support process.

Rollback owner: Alin.

## Open Issues

| Issue | Status | Impact |
|---|---|---|
| Build failure from Astro image optimization | Done | Resolved by avoiding `astro:assets` optimization in Cloudflare build |
| Product quota/copy mismatch | Open | Blocker |
| Legal placeholders | Open | Blocker |
| Background Google/email reliability | Implemented/Pending Deploy | Needs migration and production smoke verification |
| Tests not release-grade | Improved | Unit/API suite passes; E2E and production smoke still pending |
