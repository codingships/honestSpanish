# Production Audit Status

Last updated: 2026-04-15
Workspace: `C:\Users\Alin\Desktop\Academia\pruebas-auditoria`
Package manager: `pnpm` only
Primary objective: leave the project ready to start charging real customers with safe data flows, payments, emails, role boundaries, and operational reliability.

## Source of truth

This file is the working handover document for the production-readiness audit.
Any future session should read this file first before making changes.

## Current context

- This workspace is a standalone copy of the original project.
- There was no `.git` directory in this copy at the start of the audit.
- The project is a full online academy platform, not just a landing page.
- Current stack:
  - Astro SSR on Cloudflare
  - React islands
  - Supabase auth/data
  - Stripe subscriptions
  - Google Calendar/Drive/Docs integrations
  - Resend email
  - Keystatic CMS
  - Separate Cloudflare worker for reminder cron
- User instruction: ignore the current test suite as a product-quality signal if it is deprecated; replace with a better testing strategy later.
- User instruction: use `pnpm` consistently.

## Audit goal

The target is not "the app is deployed".
The target is "the app is safe and reliable enough to charge real users":

- no obvious data leaks
- no role escalation paths
- no broken or inconsistent payment flows
- no silent failures in email or cron
- reliable environment and build pipeline
- clear operational visibility and rollback safety

## High-level work plan

1. Establish a reproducible technical baseline.
2. Normalize tooling and remove environment drift.
3. Audit architecture, domains, and coupling.
4. Audit database schema, migrations, RLS, and privileged access.
5. Validate critical business flows end-to-end.
6. Audit payments, email, cron, and Google integrations.
7. Design a new production-grade testing strategy.
8. Produce a final go/no-go readiness checklist.

## Findings already confirmed

### Project shape

- Public multilingual site, blog, and CMS are present.
- Student, teacher, and admin campuses are present.
- Stripe checkout and webhook flows are present.
- Google integrations are present.
- Email and reminder cron exist.
- There is a CI workflow in `.github/workflows/ci.yml`.

### Environment and repo state

- This copy started without a Git repository.
- Git is now initialized locally.
- Baseline snapshot commit created:
  - `12fe670` - `baseline before production audit`
- Root contains generated/runtime artifacts such as `node_modules`, `dist`, `coverage`, `.astro`.
- There is package-manager/tooling drift:
  - root uses `pnpm`
  - this has now been partially corrected
  - Playwright now starts the app with `pnpm dev`
  - root workspace now includes `workers/*`
  - `workers/reminder-cron/package-lock.json` has been removed
  - worker `wrangler` and `typescript` were aligned with root versions

### Reproducibility failures seen in this workspace

- Initial failures observed:
  - `pnpm lint` ran with only minor warnings
  - `pnpm typecheck` failed because Stripe `apiVersion` no longer matched the installed SDK types
  - `pnpm test:run` failed at startup because `@vitejs/plugin-react` was not declared
  - `pnpm build` failed because `@sentry/cloudflare` was missing
- Reproducibility fixes applied:
  - added `packageManager: pnpm@10.33.0`
  - added direct dependencies needed by this standalone copy:
    - `@sentry/cloudflare`
    - `@vitejs/plugin-react`
    - `vite`
  - updated Stripe API version pin to match the installed SDK
  - aligned Playwright to `pnpm`
  - moved Sentry sourcemap upload to explicit env-based gating via `SENTRY_ORG` and `SENTRY_PROJECT`
  - updated `.env.example` with missing Sentry env vars
  - removed trivial ESLint warnings
- Current verified state:
  - `pnpm lint` passes clean
  - `pnpm typecheck` passes
  - `pnpm build` passes
  - test suite is still intentionally not used as a release gate

### Structural/rendering findings

- The `Astro.request.headers` warnings on prerendered blog/legal pages were caused by middleware touching Supabase auth for every localized route, including public static pages.
- This was not just noisy output:
  - it forced unnecessary cookie parsing on public content
  - it added avoidable auth/database work to public traffic
  - it blurred the boundary between public rendering and authenticated routing
- Middleware has now been narrowed so auth/session work only runs for localized `login` and `campus` routes.
- Multiple SSR pages declared `getStaticPaths()` even though `prerender = false`, which Astro ignored and warned about.
- Those ignored `getStaticPaths()` declarations were removed from the affected SSR pages.
- The localized RSS endpoint now explicitly prerenders, which matches its existing `getStaticPaths()` usage.
- Current verified result:
  - `pnpm build` no longer emits the previous `Astro.request.headers` prerender warnings
  - `pnpm build` no longer emits the previous `getStaticPaths()`-ignored warnings

### Observability findings

- Sentry runtime initialization was still being passed through the Astro integration, which the installed SDK now treats as deprecated.
- Sentry is now configured through dedicated runtime init files:
  - `sentry.client.config.ts`
  - `sentry.server.config.ts`
- Build-time sourcemap upload now uses the non-deprecated top-level Sentry integration options.
- The Sentry DSN remains backward-compatible with the current environment contract:
  - prefers `PUBLIC_SENTRY_DSN` when present
  - falls back to `SENTRY_DSN`
- Current verified result:
  - `pnpm build` no longer emits the previous Sentry deprecation warning

### Database context

- User provided:
  - `db/prod-notes.md`
  - `db/esquema_nube.sql`
- Stated assumptions from `db/prod-notes.md`:
  - local code and production Supabase are symmetric
  - migrations are synchronized
  - no manual orphan tables in production
  - no real customer data dump will be provided
- Audit must therefore focus on schema robustness and application code correctness rather than real production data contents.

### Block 3 findings: schema, migrations, RLS, permissions

- The repository still had real schema drift despite `db/prod-notes.md` claiming symmetry:
  - formal migrations did not reconstruct `leads`
  - formal migrations did not reconstruct `processed_webhook_events`
  - formal migrations did not reconstruct `profiles.current_level`
  - formal migrations used legacy session column names (`drive_doc_link`, `google_calendar_event_id`) while runtime code/types use `drive_doc_url` and `calendar_event_id`
- The `profiles` table is over-coupled:
  - self-service fields, billing fields, Google integration fields, and internal academic notes all live in one row
  - broad self/teacher select policies mean direct Supabase API access with a user JWT can expose more than the intended UI contract
- The main row-exposure risk is not a broken page; it is direct client access outside the UI:
  - students can read their own full `profiles` row through Supabase policies
  - students can read assigned teachers' full `profiles` rows
  - teachers can read assigned students' full `profiles` rows
  - internal-only columns therefore remain too close to the public auth surface
- The most sensitive internal profile fields are:
  - `stripe_customer_id`
  - `notes`
  - `drive_folder_id`
  - `current_level`
- `get_available_slots()` was a `SECURITY DEFINER` function callable through Supabase RPC unless execute privileges were explicitly restricted.
- Several integrity assumptions still live only in application code:
  - one active subscription per student
  - one primary teacher per student
  - teacher schedule overlap prevention is documented in `db/audit_fixes.sql` but was not part of the formal migration chain
- Generated database types were stale relative to the live schema:
  - `profiles.current_level` existed in contextual schema and runtime code but not in `src/types/database.types.ts`

### Block 3 hardening applied

- Added migration `supabase/migrations/005_harden_profile_updates_and_rpc.sql`:
  - restricts `get_available_slots()` to `service_role`
  - consolidates profile-field protection in a single trigger
  - blocks non-admin authenticated writes to:
    - `role`
    - `stripe_customer_id`
    - `drive_folder_id`
    - `notes`
    - `current_level`
- Moved the following writes/reads behind explicit server-side trust boundaries:
  - `src/pages/api/create-checkout.ts`
    - `stripe_customer_id` is now persisted with the admin client
    - checkout now fails loudly if that persistence fails
    - billing-internal profile reads no longer depend on broad student profile access
  - `src/pages/api/account/create-portal-session.ts`
    - reads `stripe_customer_id` through the admin client after authenticating the user
  - `src/pages/api/update-student-notes.ts`
    - keeps teacher/admin authorization checks with the session client
    - performs the actual `notes` update with the admin client
  - `src/pages/api/calendar/available-slots.ts`
    - keeps ownership checks with the session client
    - calls `get_available_slots()` through the admin client only
- Reduced one direct dependency on an internal billing field in the campus UI:
  - `src/pages/[lang]/campus/account.astro` no longer selects the entire profile row
  - the Stripe portal button now depends on the existence of an active subscription instead of exposing `stripe_customer_id` presence to page logic
- Added migration `supabase/migrations/006_reconcile_schema_drift.sql` to make the migration chain reflect runtime expectations again:
  - adds `profiles.current_level` if missing
  - adds `processed_webhook_events` if missing
  - adds/reconciles `leads` plus its admin policies if missing
  - ensures canonical session columns exist and backfills:
    - `drive_doc_url` from `drive_doc_link`
    - `calendar_event_id` from `google_calendar_event_id`
- Added migration `supabase/migrations/007_split_profiles_private.sql`:
  - creates `profiles_private` as the hard boundary for internal profile data
  - backfills private data out of `profiles`
  - rewires new-user creation so both `profiles` and `profiles_private` rows are created automatically
  - drops private columns from `profiles`
  - enforces:
    - one active subscription per student
    - one primary teacher per student
    - no overlapping teacher sessions at the database level
- Added `src/lib/profiles-private.ts` as the server-only access layer for `profiles_private`.
- Refactored the affected server pages and API routes so private profile fields are now read or written through `profiles_private` only:
  - student dashboard / account
  - teacher dashboard and teacher student detail page
  - admin student detail page
  - checkout and Stripe portal
  - teacher note updates
  - Drive folder creation
  - Stripe webhook folder provisioning
  - class document/calendar background tasks
  - internal full-flow test endpoint
- Updated `src/types/database.types.ts` to reflect the split:
  - removed private fields from `profiles`
  - added `profiles_private`

## Confirmed priority order

### Block 1: technical baseline

Needed before deeper audit work:

- consistent `pnpm` usage
- reproducible dependency graph
- clean `build`
- clean `typecheck`
- CI aligned with local tooling

### Block 2: structural audit

- domain boundaries
- route vs service responsibilities
- integration boundaries
- operational coupling

### Block 3: data and security audit

- schema
- migrations
- RLS
- admin paths
- service-role usage

### Block 4: business flow audit

- lead capture
- auth and profile creation
- checkout
- webhook processing
- subscription lifecycle
- teacher assignment
- session scheduling
- cancellation and completion
- email notifications
- reminder cron

### Block 5: new testing strategy

The old suite is not a blocker by itself.
What matters is building a new suite that protects the real business-critical paths.

## Recommended target architecture direction

Do not split this into microservices.
Recommended direction: modular monolith with domain slices.

Target domains:

- `auth`
- `users`
- `billing`
- `scheduling`
- `notifications`
- `leads`
- `content`
- `integrations`

Desired rule:

- routes/pages stay thin
- business logic moves into domain services
- Supabase access is centralized per domain
- Stripe/Google/Email are wrapped behind adapters/services
- role checks are centralized instead of repeated ad hoc

## Working log

### 2026-04-15

- Inspected project structure and key files.
- Confirmed there was no `.git` directory in this workspace copy.
- Verified main stack and product scope.
- Ran baseline commands:
  - `pnpm lint`
  - `pnpm typecheck`
  - `pnpm test:run`
  - `pnpm build`
- Identified current reproducibility blockers.
- Read production database notes and contextual schema.
- Created this handover file at the repository root.
- Initialized Git locally and created baseline commit `12fe670`.
- Standardized the workspace on `pnpm`.
- Added missing direct dependencies required for this standalone copy to build and typecheck correctly.
- Replaced `npm run dev` with `pnpm dev` in Playwright config.
- Removed worker `package-lock.json` and aligned worker tooling with root versions.
- Gated Sentry sourcemap upload behind explicit env variables instead of a hardcoded project name.
- Re-ran baseline validation successfully:
  - `pnpm lint`
  - `pnpm typecheck`
  - `pnpm build`
- Investigated repeated Astro prerender warnings on blog/legal routes.
- Confirmed the root cause was middleware creating a Supabase server client for every localized route, including public prerendered pages.
- Restricted middleware auth/session work to localized `login` and `campus` routes only.
- Removed ignored `getStaticPaths()` declarations from SSR-only pages.
- Marked the localized RSS endpoint for prerender so its static path generation is coherent.
- Re-ran validation after the rendering-contract cleanup:
  - `pnpm lint`
  - `pnpm typecheck`
  - `pnpm build`
- Migrated Sentry runtime initialization out of `astro.config.mjs` into dedicated client/server config files.
- Moved Sentry sourcemap upload configuration to the integration's non-deprecated top-level options.
- Added a backward-compatible DSN bridge so the client SDK can still work with the existing `SENTRY_DSN` setup.
- Updated `.env.example` to document the preferred `PUBLIC_SENTRY_DSN` alias.
- Re-ran validation after the Sentry cleanup:
  - `pnpm lint`
  - `pnpm typecheck`
  - `pnpm build`
- Started Block 3: schema, migrations, RLS, and permissions audit.
- Confirmed that the formal migration chain was incomplete relative to the schema the app actually uses in production/runtime code.
- Confirmed that `profiles` currently mixes public/self-service fields with internal billing and operational fields.
- Confirmed that `get_available_slots()` needed explicit execute restrictions because it is a `SECURITY DEFINER` RPC.
- Added migration `005_harden_profile_updates_and_rpc.sql` to harden internal profile fields and private RPC access.
- Moved billing-internal profile reads/writes behind the Supabase admin client in checkout and Stripe portal flows.
- Moved student note writes behind the Supabase admin client after explicit teacher/admin authorization.
- Updated the campus account page to stop selecting the full profile row.
- Added migration `006_reconcile_schema_drift.sql` to reconcile missing formal schema pieces and canonical session column names.
- Implemented the hard split of `profiles` vs `profiles_private`.
- Added SQL uniqueness constraints for active subscriptions and primary-teacher assignment.
- Formalized the no-overlap teacher scheduling constraint in the migration chain.
- Added a dedicated server-only helper layer for private profile access.
- Refactored the SSR campus pages and server endpoints that previously depended on private profile columns.
- Updated `db/schema.sql` to reflect the new public/private profile split for repository-level documentation.
- Re-ran validation after the split:
  - `pnpm lint`
  - `pnpm typecheck`
  - `pnpm build`
- Re-ran validation during Block 3:
  - `pnpm typecheck`
- Tried to operate the linked Supabase project directly from this machine with `pnpm dlx supabase`.
- Confirmed the linked project ref from `.env` is `vkkahxsybhbutszerawz`.
- Confirmed this workspace copy does not contain a usable `supabase/config.toml`, linked project metadata, or remote Postgres password.
- Confirmed the local machine does not expose an immediately reusable Supabase CLI login/profile for this project.
- Added repeatable smoke script `scripts/smoke/real-env-smoke.ts`.
- Added repeatable Stripe-preparation script `scripts/smoke/prepare-stripe-smoke.ts`.
- Ran real smoke checks against the deployed site `https://espanolhonesto.com`.
- Ran the same critical endpoints against the local current code (`pnpm dev`) pointing at the same remote Supabase project to separate deployment drift from schema drift.
- Re-ran validation after adding the smoke script:
  - `pnpm lint`
  - `pnpm typecheck`
  - `pnpm build`
- The Supabase project was later linked locally through the CLI.
- Repaired remote migration history to mark `000` through `004` as already applied.
- Applied `005_harden_profile_updates_and_rpc.sql` and `006_reconcile_schema_drift.sql` directly to the remote Supabase project.
- Patched `007_split_profiles_private.sql` so it safely drops legacy role-protection triggers before removing old functions.
- Applied `007_split_profiles_private.sql` directly to the remote Supabase project.
- Verified runtime state after migration:
  - `profiles_private` exists and is queryable
  - legacy private columns no longer exist on `profiles`
  - local and remote migration history now match through `007`
- Added `scripts/smoke/prepare-stripe-smoke.ts` and used it to create recurring Stripe test prices programmatically, then write those IDs back into `packages`.
- Updated the smoke script so it can target a configurable base URL via `SMOKE_BASE_URL`.
- Updated the smoke script so it works against the new `profiles_private` split and assigns both smoke students to a teacher.
- Re-ran local smoke against the current code with `SMOKE_BASE_URL=http://127.0.0.1:4323`.
- Corrected a billing logic bug in `src/pages/api/stripe-webhook.ts`:
  - recurring renewals no longer assume `+1` month unconditionally
  - renewal extension now respects Stripe `interval_count`
  - session quota refresh now scales with the renewal interval
  - subscription end date now extends from the later of `today` or the current `ends_at`
- Re-ran validation after the billing renewal fix:
  - `pnpm lint`
  - `pnpm typecheck`
  - `pnpm build`
- Re-ran the full local smoke successfully after the billing renewal fix.
- Extended the smoke harness to cover:
  - `invoice.payment_failed`
  - `customer.subscription.updated` pause/resume transitions
  - multi-month `invoice.paid` renewals
  - `customer.subscription.deleted`
  - scheduling conflict / cancel / rebook lifecycle
- Found and fixed a real scheduling bug:
  - `POST /api/calendar/sessions`, `bulk-sessions`, and `recurring-sessions` created the session row first
  - then tried to consume subscription quota through the session-scoped Supabase client
  - teacher/admin RLS did not allow that `subscriptions` update
  - the route interpreted that as a quota/concurrency failure, rolled the session back to `cancelled`, and returned false `409` responses
  - quota consumption now runs through the admin client after authorization has already been checked
- Re-ran validation after the scheduling quota fix:
  - `pnpm lint`
  - `pnpm typecheck`
  - `pnpm build`
- Re-ran the expanded local smoke successfully after the scheduling quota fix.

## Current technical state

- The workspace is now reproducible enough to continue the real audit.
- The original "copy vs original project" hypothesis was partly correct:
  - some failures were due to the copy not being self-contained
  - those have now been fixed
- The linked Supabase runtime is now aligned with the local migration chain through `007`.
- The `profiles` / `profiles_private` split is now live remotely, not just local.
- The local code path for:
  - notes
  - Drive provisioning
  - checkout session creation
  - webhook idempotency
  - subscription/payment persistence
  has been exercised successfully against the migrated remote Supabase project.
- Stripe test-mode recurring prices now exist and are mapped into `packages` programmatically for smoke purposes.
- Remaining non-blocking warnings to audit next:
  - `keystatic-page` client chunk is very large and should be reviewed later
  - Cloudflare adapter warns about sharp/runtime image behavior
- Important structural improvement already applied:
  - public localized pages no longer trigger auth/session work in middleware by default
  - build output is materially cleaner and now closer to a trustworthy release signal
- Important observability improvement already applied:
  - Sentry runtime config is aligned with the installed SDK's current initialization model
  - the build no longer hides a deprecation that would become a future production breakage
- Important Block 3 improvement already applied:
  - the most obvious direct-write path from user JWTs into internal profile fields is now blocked centrally at the database layer
  - private profile data is now structurally separated from self-service profile data
  - billing/Drive/teacher-note reads are now routed through authenticated server-only code paths
- Important billing improvement already applied:
  - renewal logic now respects multi-month Stripe subscription intervals instead of always extending by one month
- Important scheduling improvement already applied:
  - subscription quota consumption for scheduling now runs through server-only admin paths instead of failing under teacher RLS
  - single-session, bulk-session, and recurring-session booking now share the same quota-consumption trust boundary
- Block 3 is effectively complete for the migrated test environment:
  - schema hardening is applied locally and remotely
  - the critical business flows have been revalidated after migration

## Smoke audit: real environment

### Historical note: pre-link state

- Before the project was linked through the CLI, the runtime still exposed legacy private fields on `profiles`, `profiles_private` was unavailable, and local code failed as expected against that old schema.
- Those observations were valid at the time and explain the earlier failures recorded below.
- They are no longer the current state of the test environment.

### Current state after remote migration + local smoke

Repeatable preparation and smoke commands:

1. `pnpm tsx scripts/smoke/prepare-stripe-smoke.ts`
2. start local server: `pnpm dev --host 127.0.0.1 --port 4323`
3. `SMOKE_BASE_URL=http://127.0.0.1:4323 pnpm tsx scripts/smoke/real-env-smoke.ts`

Latest successful result at `2026-04-15T20:13:01.253Z`:

- Schema:
  - `profilesPrivateAvailable: true`
  - `profilesStillExposeLegacyPrivateColumns: false`
- Stripe:
  - `activeRecurringPrices: 3`
  - `activeOneTimePrices: 9`
  - active package now has a real recurring 1-month test price id
- Notes flow:
  - `POST /api/update-student-notes` returned `200`
  - note persisted correctly in `profiles_private`
- Drive flow:
  - `POST /api/google/create-student-folder` returned `200`
  - folder tree and index docs were created successfully
  - resulting `drive_folder_id` persisted correctly in `profiles_private`
- Checkout flow:
  - `POST /api/create-checkout` returned `200`
  - returned a real Stripe test checkout URL
- Webhook flow:
  - synthetic `checkout.session.completed` first call returned `200`
  - second duplicate call returned `200`
  - side effects were correct:
    - `1` subscription created
    - `1` payment created
    - `1` processed webhook event row created
    - student Drive folder persisted

### Extended lifecycle smoke

Repeatable commands used for the expanded lifecycle validation:

1. `pnpm tsx scripts/smoke/prepare-stripe-smoke.ts`
2. start local server: `pnpm dev --host 127.0.0.1 --port 4325`
3. `SMOKE_BASE_URL=http://127.0.0.1:4325 pnpm tsx scripts/smoke/real-env-smoke.ts`

Latest successful expanded result at `2026-04-15T22:40:38.429Z`:

- Billing lifecycle:
  - checkout preparation returned `200`
  - synthetic `checkout.session.completed` created the initial active `3`-month subscription
  - synthetic `customer.subscription.updated` with `past_due` paused the local subscription
  - synthetic `invoice.payment_failed` recorded a failed payment row and kept the subscription paused
  - synthetic `customer.subscription.updated` with `active` resumed the subscription
  - synthetic `invoice.paid` renewed the subscription correctly:
    - `ends_at` moved from `2026-07-15` to `2026-10-15`
    - `sessions_total` refreshed to `12`
    - `sessions_used` reset to `0`
  - synthetic `customer.subscription.deleted` marked the subscription as `cancelled`
- Scheduling lifecycle:
  - Drive folder creation for the scheduling student returned `200`
  - first real booking returned `201`
  - duplicate booking of the same slot returned `409`
  - cancellation returned `200`
  - the session row cleared `calendar_event_id` and `meet_link`
  - subscription quota moved `0 -> 1 -> 0`
  - rebooking the same slot after cancellation returned `201`
  - cleanup cancellation returned `200`
  - final subscription quota returned to `0`
  - Google Calendar keeps cancelled events retrievable with status `cancelled`; the smoke now treats that as the expected retired state rather than requiring a hard `404`

### Residual notes from the expanded smoke

- Google Drive folder sharing emits warnings for smoke users on `@example.com` because those emails do not map to Google accounts.
- This did not block folder creation or persistence, but it confirms a product dependency:
  - if real students are expected to access Drive directly, either they need Google-capable emails/accounts or the sharing strategy needs a fallback path.

### Conclusion of this phase

- For the local current code plus the linked Supabase test project, the critical smoke path is now green.
- The billing renewal/failure/cancellation loop is now validated end-to-end against the local current code and the linked Supabase/Stripe test environment.
- The scheduling conflict/cancel/rebook loop is also validated end-to-end after fixing the quota-consumption trust boundary.
- The remaining gap is no longer local schema drift.
- The remaining production-readiness work is now mostly:
  - broader business-flow coverage
  - operational hardening
  - deploy/runtime alignment
  - replacing the legacy test suite with a purposeful one

## 2026-04-16 - Final campus closure and verdict

### Scope completed in this block

- Implemented the Drive "progressive opening" strategy end-to-end:
  - new migration `008_progressive_drive_access.sql`
  - new private columns in `profiles_private`:
    - `drive_folder_url`
    - `google_account_email`
  - Stripe/manual folder creation now persists both folder id and share URL
  - default folder access is now `anyone with the link` as `reader`
  - new student endpoint: `POST /api/account/link-google-drive`
  - student account UI now allows linking a Google account after signup
  - linking a Google account revokes public-link access and grants explicit Drive permission to that email
- Hardened private profile writes:
  - `upsertPrivateProfile()` now does `UPDATE` first and only inserts when the row does not exist
  - this avoids partial-upsert failures against the new `google_account_email requires drive_folder_id` constraint
- Hardened class lifecycle mutations:
  - `complete` / `no_show` now require a `scheduled` session
  - they are rejected if the class has not started yet
  - transition is now guarded server-side instead of relying on the UI
- Hardened reminder cron:
  - `reminder_sent` is only flipped to `true` when both emails succeed
  - failures no longer get silently acknowledged as "already reminded"
- Fixed an operational KPI bug:
  - admin calendar completion rate no longer counts cancellations in the denominator

### Database / runtime state

- `pnpm dlx supabase db push` applied `008_progressive_drive_access.sql` successfully to the linked Supabase test project.
- The linked runtime now matches the current code for:
  - `profiles_private`
  - Drive progressive access fields
  - the prior `005/006/007` hardening chain

### Latest full green smoke

Repeatable commands:

1. start local server: `pnpm dev --host 127.0.0.1 --port 4325`
2. `SMOKE_BASE_URL=http://127.0.0.1:4325 pnpm tsx scripts/smoke/real-env-smoke.ts`

Latest successful result at `2026-04-16T08:46:39.732Z`:

- Drive progressive access:
  - folder creation returned `200`
  - `drive_folder_id` and `drive_folder_url` persisted
  - public link permission existed immediately after creation
  - student link endpoint returned `200`
  - `google_account_email` persisted correctly
  - public-link access was revoked
  - explicit Google permission was granted to `alindev95@gmail.com`
- Billing lifecycle:
  - green end-to-end for checkout, activation, `invoice.payment_failed`, `customer.subscription.updated`, `invoice.paid`, cancellation
- Campus lifecycle:
  - scheduling conflict / cancel / rebook green
  - class completion green
  - `no_show` green
  - quota behaviour validated:
    - booking consumes quota
    - cancellation refunds quota
    - completion keeps quota consumed
    - `no_show` keeps quota consumed
  - reminder cron green:
    - unauthorized call returns `401`
    - authorized call returns `200`
    - `processed = 1`
    - `sent = 2`
    - `failed = 0`
    - `reminder_sent` persisted correctly
  - operational views green:
    - teacher dashboard `200`
    - teacher calendar `200`
    - admin calendar `200`
    - all contained the smoke student/session data
    - admin view reflects `completed` and `no_show`

### Final technical verdict

- Verdict: **GO técnico para empezar a facturar**, with minor non-blocking follow-up only.
- In practical terms: the code currently in this repo, with the linked Supabase test project and the configured Stripe/Google/Resend integrations, now passes the critical monetization + campus operations loop.
- The core release blockers that existed at the start of the audit are closed:
  - schema drift
  - broken build/typecheck
  - Stripe lifecycle gaps
  - quota rollback bug
  - private profile exposure
  - Drive access fallback gap
  - reminder silent-success bug
  - missing server-side guards for completion / `no_show`

### Residual non-blockers

- Cloudflare image warning about `sharp` remains.
- The `keystatic-page` client chunk is still very large.
- The legacy automated test suite is still not a release gate and should remain ignored/replaced.
- Production deployment provenance was intentionally left out of scope in this block, per instruction.

### What still needs attention after launch readiness

1. Deploy this exact code state to the real runtime path you intend to use for first paying users.
2. Keep using the smoke script as the post-deploy release check.
3. Replace the legacy test suite with a compact intentional suite built around these smoke-validated business flows.

## Next actions

1. Reconcile deploy provenance when ready to care about Cloudflare again:
   - confirm which repo/branch/build is actually deployed to Cloudflare
   - confirm deployed environment variables match the linked Supabase project expected by this repo
2. Review Cloudflare/image warnings and confirm runtime image strategy.
3. Review the oversized `keystatic-page` client chunk and decide whether code-splitting or route isolation is needed.
4. Design the replacement testing strategy for production readiness.

## Notes for future sessions

- Read this file first.
- Prefer small, reviewable changes.
- Keep `pnpm` as the only package manager.
- Do not treat the current tests as a release gate.
- The baseline, the rendering-contract cleanup, and the Sentry deprecation cleanup are already complete.
- The `profiles`/`profiles_private` split is now applied both locally and on the linked Supabase runtime.
- Use `scripts/smoke/prepare-stripe-smoke.ts` before smoke runs if you need to ensure Stripe recurring test prices exist and are synced into `packages`.
- Use `scripts/smoke/real-env-smoke.ts` as the repeatable smoke entrypoint.
- `SMOKE_BASE_URL` lets the smoke script target local dev instead of the deployed site.
- The expanded smoke now validates:
  - checkout
  - initial webhook activation
  - `invoice.payment_failed`
  - `customer.subscription.updated`
  - `invoice.paid`
  - `customer.subscription.deleted`
  - scheduling conflict / cancel / rebook
- The current smoke also validates:
  - Drive progressive opening
  - student Google-account linking
  - class completion
  - `no_show`
  - quota persistence after completion / no-show
  - reminder cron
  - teacher/admin operational views
- Current highest-priority blockers for broader production readiness are no longer schema drift; they are coverage depth, operational hardening, and deployment alignment.
