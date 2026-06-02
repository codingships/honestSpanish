---
artifact: launch-runbook
version: "1.0"
created: 2026-05-29
status: draft
updated: 2026-05-29
---

# Operations Runbook

This runbook describes how to operate the platform during launch. It should stay practical and current.

## Critical Flow

1. Student registers.
2. Student selects a package and pays through Stripe Checkout.
3. Stripe webhook creates or updates the subscription and payment record.
4. Stripe webhook enqueues welcome fulfillment.
5. Fulfillment creates student Drive folder and sends welcome email through Resend.
6. Student books a class.
7. Booking endpoint enqueues session fulfillment.
8. Fulfillment creates class document, Calendar event, Meet link, and confirmation emails through Resend.
9. Reminder cron sends class reminders and also processes due fulfillment jobs.

## Common Incidents

### Payment Completed But No Subscription

Check:
- Stripe event delivery for `checkout.session.completed`.
- `processed_webhook_events` for duplicate or missing event.
- `subscriptions` and `payments` rows for the student.
- Sentry/logs for webhook errors.

Recovery:
- Reprocess or manually create the subscription only after confirming Stripe payment.
- Do not grant duplicate sessions without checking existing active subscription.

### Subscription Exists But No Drive Folder

Check:
- `profiles_private.drive_folder_id`.
- `fulfillment_jobs` rows with `job_type = 'welcome_fulfillment'`.
- Google service account credentials and delegated scopes.
- Google Drive root folder configuration.
- Resend delivery if the folder exists but the welcome email is missing.

Recovery:
- Trigger `/api/cron/process-fulfillment` with the bearer token if due jobs are pending.
- Use the admin folder creation endpoint only after verifying the target student.
- Share link or direct Google permission according to the Drive access decision.

### Class Booked But No Meet Link Or Doc

Check:
- `sessions.drive_doc_id`, `sessions.drive_doc_url`, `sessions.calendar_event_id`, `sessions.meet_link`.
- `fulfillment_jobs` rows with `job_type = 'session_fulfillment'` or `bulk_session_fulfillment`.
- Google Calendar availability and event creation logs.
- Whether the booking was created through single, bulk, or recurring flow.
- Resend delivery status for confirmation emails.

Recovery:
- Trigger `/api/cron/process-fulfillment` with the bearer token if due jobs are pending.
- Create the Google Calendar event and class doc manually if needed.
- Update the session record with final links.
- Send confirmation email manually or through an admin tool.

### Reminder Not Sent

Check:
- `sessions.reminder_sent`.
- Worker schedule and `CRON_SECRET`.
- `/api/cron/send-reminders` logs.
- `/api/cron/process-fulfillment` logs if pending fulfillment also failed.
- Resend delivery status.

Recovery:
- Trigger the cron endpoint only with the bearer token.
- Do not use a public unauthenticated worker test route in production.

### Package Active But Checkout Disabled

Check:
- Admin CRM at `/es/campus/admin/packages`.
- Package `is_active`.
- `stripe_price_1m`, `stripe_price_3m`, and `stripe_price_6m`.
- Stripe product/price active state in the intended Stripe mode.

Recovery:
- Save the package first.
- Run Stripe synchronization from the CRM.
- If the CRM cannot be used, run `pnpm exec tsx scripts/sync-stripe-packages.ts` to preview and `pnpm exec tsx scripts/sync-stripe-packages.ts --apply` to create/update Stripe Products/Prices and write Price IDs back to Supabase.
- Confirm the public pricing button is enabled only after all required recurring Price IDs are present.

## External Services To Monitor

| Service | Used For | Launch Check |
|---|---|---|
| Supabase | Auth, Postgres, RLS, service role operations | Env vars, backups, RLS, migrations |
| Stripe | Checkout, portal, webhooks, subscription state | Webhook URL, signing secret, price IDs |
| Google Workspace | Drive folders, Docs, Calendar, Meet | Service account, delegated scopes, root/template IDs |
| Resend | Transactional emails | API key, sender domain, delivery logs |
| Cloudflare Pages | Main app hosting and API runtime | Env vars, build, deployment branch, KV session binding |
| Cloudflare Cron | Reminders and fulfillment retries | `APP_URL`, `CRON_SECRET`, schedule |
| Sentry | Error monitoring | DSN, org/project/auth token, alerts |

## Manual Go-Live Verification

Do not run real write-heavy smoke checks without confirming the target environment first.

Reusable smoke scripts:

```bash
pnpm exec tsx scripts/sync-stripe-packages.ts
pnpm exec tsx scripts/sync-stripe-packages.ts --apply
pnpm exec tsx scripts/smoke-checkout.ts
```

`scripts/smoke-checkout.ts` creates a temporary student, signs in through the app, calls `/api/create-checkout`, verifies that Stripe returns a Checkout URL, and then deletes the temporary Supabase user and Stripe customer where possible. It creates a Checkout Session but does not complete a payment.

Minimum safe launch verification:

- [ ] Public pages load in ES/EN/RU.
- [ ] Login/register works.
- [ ] Stripe checkout creates a checkout URL for an active package.
- [ ] Stripe webhook can process a test event in the intended Stripe mode.
- [ ] Student subscription appears in campus.
- [ ] Welcome fulfillment job succeeds and creates Drive folder.
- [ ] Teacher/admin can book a class.
- [ ] Session has Meet link and Drive doc.
- [ ] Emails arrive to student and teacher.
- [ ] Reminder cron marks `reminder_sent`.

## E2E Test Data

Prepare local/Supabase E2E users and baseline data with:

```bash
pnpm exec tsx scripts/prepare-e2e-data.ts
```

The script reads Supabase credentials from `.env` and test user credentials from `.env.test`. It updates the three test users, sets roles, assigns student to teacher, creates an active test subscription, availability, and seed sessions. It clears sessions for those dedicated E2E student/teacher accounts first so repeated scheduling tests do not accumulate conflicts.

For local Playwright booking tests, `.env.test` should keep `E2E_DISABLE_EXTERNAL_INTEGRATIONS=true`. This lets scheduling write Supabase sessions without creating Google Calendar/Meet/Docs or sending Resend emails.

## Documentation Rule

If an operational decision changes, update this runbook and `DECISIONS.md` in the same change.
