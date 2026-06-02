---
artifact: launch-decisions
version: "1.0"
created: 2026-05-29
status: active
updated: 2026-05-29
---

# Launch Decisions

This document is the current source for product and technical decisions that affect launch readiness. Older audit notes are historical evidence, not authoritative state.

## Decided

### Google Workspace Automation

Decision: keep Service Account with Domain-Wide Delegation.

Rationale:
- The product already depends on Google Drive, Calendar, Docs, and Meet.
- The current offline operating model also uses Drive heavily.
- Centralized automation avoids asking every teacher or student to complete OAuth setup before basic operations work.

Pros:
- Fast operational flow.
- Less manual setup for teachers.
- Works with the existing Google Workspace process.

Cons:
- Broad delegated access must be guarded carefully.
- Credential rotation and scope review become operational requirements.
- Bugs in privileged server code can have wider impact.

Launch requirement:
- Document the Google Cloud project, service account, delegated scopes, impersonated admin email, and rotation process outside the repo.

### Drive Access Model

Decision: keep progressive Drive access. New student folders can start as "anyone with link can view"; students can later link a Google account and the public-link permission is revoked.

Rationale:
- Current classes already run through Drive.
- Some students start without a Google account but usually create one later.
- Launch should not block paid students who are not yet ready with Google.

Pros:
- Low friction.
- Keeps the current teaching workflow.
- Avoids urgent support load at first login.

Cons:
- Anyone with the link can view until the student links a Google account.
- Requires clear internal rules about what is safe to place in the folder before direct account linking.

Launch requirement:
- Do not place highly sensitive material in a public-link folder before the student links a Google account.
- Make the link/revoke behavior visible in the account UI and support runbook.

### Background Processing For Google And Email

Decision: use persistent `fulfillment_jobs` plus Cloudflare `waitUntil`.

Implemented behavior:
- Booking and checkout endpoints enqueue work in `fulfillment_jobs`.
- Cloudflare `waitUntil` processes jobs after the HTTP response when runtime context exists.
- `/api/cron/process-fulfillment` and `/api/cron/send-reminders` can process due jobs again.
- Resend remains the email provider; the change is reliability and retry visibility, not a provider change.

Pros:
- Faster booking/payment responses.
- Failures are persisted with attempts and `last_error`.
- A cron retry path can recover from transient Google or Resend failures.

Cons:
- Requires the 009 Supabase migration before production jobs are fully active.
- Requires monitoring `fulfillment_jobs` or surfacing failures in admin later.

Launch requirement:
- Apply the migration and verify a paid user can receive Drive, Calendar/Meet, Docs, welcome email, confirmation email, and reminders.

### Products, Pricing, And Quotas

Decision: active Supabase packages are the launch catalog, managed from the admin CRM.

Launch catalog:
- `group`: 50 EUR, 4 classes/month, group included.
- `standard`: 145 EUR, 4 classes/month.
- `hybrid`: 150 EUR, 4 classes/month, group and dual teacher included.
- `bootcamp`: 345 EUR, 20 classes/month.

Pros:
- One operational place to update runtime pricing.
- Stripe synchronization creates recurring prices that match checkout mode.
- Public pricing can disable checkout until a package has complete Stripe IDs.

Cons:
- Admin changes affect the public catalog, so only trusted admins should use it.
- Stripe Price IDs are immutable, so changing prices creates replacement prices rather than editing the old ones.

Launch requirement:
- Synchronize Stripe prices from the CRM and review public copy in ES/EN/RU.

### Class Duration

Decision: default scheduled class duration is 55 minutes.

Important distinction:
- 55 minutes is the commercial and scheduling duration.
- The platform does not cut off Google Meet automatically.
- Admin can schedule other durations when needed.

## Pending

### Registration Before Payment

Current direction:
- Keep registration before payment for the first launch.

Pros:
- Stripe customers and subscriptions map cleanly to Supabase users.
- Webhook processing is simpler.
- Fewer ambiguous paid-but-not-registered states.

Cons:
- More friction before checkout.
- May reduce conversion if traffic is cold.

Decision needed:
- Revisit after marketing/sales strategy is clearer and after early conversion data exists.

### Markdown Governance

Decision:
- Keep new launch docs as active docs.
- Treat previous audit docs as archive candidates after their useful findings are migrated.

Pros:
- Future sessions get concise current context.
- Historical notes remain available during cleanup.

Cons:
- Requires one cleanup pass after the active docs are complete.

Launch requirement:
- Before launch, archive or delete obsolete audit docs so agents and humans do not follow stale instructions.
