# CRM Work Plan

## Current State

The current admin area already has useful operational modules:

- `/campus/admin`: admin metrics, recent payments, recent registrations.
- `/campus/admin/leads`: simple lead inbox with three states: new, contacted, discarded.
- `/campus/admin/users`: teacher/student matching.
- `/campus/admin/students`: richer student list and student detail route.
- `/campus/admin/student/[id]`: plan, teacher, notes, payments and subscriptions.
- `/campus/admin/payments`: payment history.
- `/campus/admin/support`: support ticket triage.
- `/campus/admin/jobs`: operational job recovery.
- `/campus/admin/emails`: email template preview/test.
- `/campus/admin/calendar`: global class calendar.

The gap is not that there is no CRM. The gap is that the CRM is fragmented:

- A lead and a student are not yet the same long-lived relationship record.
- There is no pipeline/opportunity model.
- There are no follow-up tasks.
- There is no relationship timeline.
- Consent/provenance is not explicit enough for imported or older contacts.
- Dashboard is metrics-first, not work-queue-first.
- Student screens are split between `users` and `students`.
- Current styling is recognizable but repeated through raw Tailwind classes and hex colors.

## Target State

The custom CRM should behave like a small-business CRM inside the existing admin app:

- Admin opens the app and sees today's urgent work.
- Every person has one central contact record.
- Leads, old students, active students and inactive students are lifecycle stages of a contact.
- Opportunities track possible purchases/enrollments.
- Tasks track what must be done next.
- Activities track what already happened.
- Payments, classes, support and emails appear in the contact timeline.
- Consent and opt-out are modeled before outbound campaigns.
- The visual style stays recognizably the current Español Honesto admin style.

## Phase 0: Visual Guardrails First

Purpose: prevent the CRM build from drifting visually.

Work:

- Extract existing campus/admin visual tokens:
  - `#E0F7FA`
  - `#006064`
  - `#004d40`
  - `#6A131C`
  - `#F6FE51`
  - display/sans/mono typography usage
  - 2px borders
  - offset teal shadows
  - dense admin tables
- Add token names to Tailwind/CSS without changing rendered output.
- Add reusable admin primitives:
  - admin card
  - admin button
  - admin table
  - admin badge
  - admin filter bar
  - empty state
- Add a style guard script that flags arbitrary new hex colors outside the token source.
- Add Playwright visual baselines for current admin routes.

Validation:

- Existing admin pages still render the same.
- Screenshot baselines are generated.
- Style guard passes.
- `pnpm typecheck` and relevant tests pass.

Stop condition:

- This phase stops when the current UI has a visual safety net. It does not redesign the admin area.

## Phase 1: CRM Schema Foundation

Purpose: create the model that HubSpot/Salesforce would normally provide.

Work:

- Add CRM tables:
  - `crm_contacts`
  - `crm_opportunities`
  - `crm_tasks`
  - `crm_activities`
  - `crm_consents`
  - `crm_import_batches`
  - `crm_import_batch_contacts`
- Add RLS policies and admin-only write paths.
- Add indexes for dashboard, pipeline, follow-up and timeline queries.
- Keep existing tables as operational tables.

Validation:

- Migration applies cleanly.
- Database tests prove foreign keys, indexes and RLS expectations.
- No existing admin route breaks.

Stop condition:

- Schema exists, is tested, and no UI behavior has been forced onto it yet.

## Phase 2: Backfill And Compatibility

Purpose: connect current data to the new model without losing the old workflows.

Work:

- Backfill `leads` into `crm_contacts` and `crm_opportunities`.
- Backfill `profiles` into `crm_contacts`.
- Link active students to their contact record.
- Keep existing lead/student pages functional during transition.
- Define duplicate handling by normalized email.

Validation:

- Every current lead has a CRM contact.
- Every current student has a CRM contact.
- Existing pages still load.
- Duplicate imports do not create duplicate people.

Stop condition:

- Current data can be read from the new CRM model without breaking existing screens.

## Phase 3: Admin Command Center

Purpose: make `/campus/admin` answer "what needs attention today?"

Work:

- Replace metrics-only dashboard with work queues:
  - overdue tasks
  - new leads
  - follow-ups due today
  - open support tickets
  - failed payments
  - subscriptions ending soon
  - classes today
- Keep revenue and student metrics as secondary blocks.

Validation:

- Admin can see urgent work without opening five pages.
- Empty states are clear.
- Visual snapshot remains consistent.

Stop condition:

- Dashboard is a daily operating surface, not a full analytics suite.

## Phase 4: Pipeline And Tasks

Purpose: upgrade `CRM Leads` into a real pipeline.

Work:

- Replace simple lead states with opportunity stages:
  - new
  - to_contact
  - contacted
  - qualified
  - proposal
  - won
  - lost
  - nurture
- Add task creation and completion.
- Add due dates and owner assignment.
- Add lost reason and nurture reason.

Validation:

- A new inbound lead appears in the pipeline.
- Admin can create a follow-up task.
- Moving to won can link to subscription/customer state.

Stop condition:

- Pipeline supports the expected sales flow without automation.

## Phase 5: Contact/Student Relationship View

Purpose: make the contact page the source of truth.

Work:

- Add a central CRM contact detail route.
- Show:
  - profile data
  - lifecycle stage
  - opportunities
  - tasks
  - activities
  - notes
  - subscriptions
  - payments
  - classes
  - support tickets
  - consent status
- Keep teacher-facing academic notes separate where needed.

Validation:

- A user can understand a person's full relationship from one page.
- Support/payment/class events appear in the timeline.

Stop condition:

- Contact detail is useful enough to replace jumping between pages.

## Phase 6: Imports And Consent

Purpose: allow old email lists without creating legal or operational mess.

Work:

- Add import batch tracking.
- Require source/provenance notes.
- Mark contacts from old lists as `manual_review_required` until approved.
- Add opt-out/unsubscribe fields.
- Add "do not contact" enforcement before sending from the app.

Validation:

- Imported contacts are traceable to a batch.
- The app can distinguish transactional, sales follow-up and marketing contact.
- No bulk send path ignores opt-out.

Stop condition:

- Imports can be stored safely even before any campaign is sent.

## Phase 7: Email Integration

Purpose: move from manual follow-up to tracked communication.

Work:

- First: log manual email/call/WhatsApp activities with channel, direction, purpose and consent-review metadata.
- Then: send one-off templated emails from the app.
- Later: add sequences only if needed.

Validation:

- Manual communications create typed CRM activities instead of internal notes.
- Outbound sales/marketing communication checks the latest consent row before logging.
- Sent emails create activities once a send path exists.
- Failed/suppressed sends are visible.
- Consent checks block unsafe sends.

Stop condition:

- No automation is added until manual workflow proves useful.

## Phase 8: Reporting

Purpose: understand conversion and retention without bloating the product.

Work:

- Lead source conversion.
- Pipeline stage counts.
- Follow-up completion.
- Won/lost reasons.
- Retention risks.
- Revenue by lifecycle/source.

Validation:

- Reports answer decisions the business will actually make.

Stop condition:

- Reporting stays decision-oriented, not vanity dashboards.

## Recommended Defaults

- Start with email/manual tasks, not automated sequences.
- Treat old students as `alumni` contacts.
- Treat current paying students as `customer` contacts.
- Treat inbound forms as `lead` contacts with an open opportunity.
- Keep support tickets as support records, but mirror important events into CRM activity.
- Keep `admin_audit_log` separate from CRM activity.

## Resolved Defaults

- `/campus/admin` is the daily command center. Relationship work stays inside the existing admin instead of becoming a separate product.
- The first CRM owner model supports the current admin user and can later support the partner through `assigned_to` fields.
- Old student email imports and campaigns are deferred. The CRM keeps consent/provenance primitives, but no bulk outreach path is built now.
- Manual CRM notes and tasks are the first operating layer before automation.
- WhatsApp/phone/email are logged manually from day one as CRM activities, not as internal notes.

## Remaining Decisions

These are the next decisions needed during implementation:

1. Do we need a lightweight "owner" filter once the partner starts using the admin, or is a shared queue enough for now?
2. Which reporting decisions matter first after the daily queue: conversion by source, retention risk, failed payment recovery, support burden, or teacher capacity?

## First Implementation Slice

Do Phase 0 first:

1. Tokenize the current visual style.
2. Add visual snapshot baselines.
3. Add style drift checks.

Then do a narrow CRM data slice:

1. Add contacts, opportunities, tasks and activities.
2. Backfill current leads and students.
3. Build the command center using those tables.

## Progress Notes

- Phase 0 visual guardrails are in place: Tailwind/CSS tokens, admin primitives, palette guard and Playwright snapshots.
- CRM v1 schema work starts with contacts, opportunities, tasks, activities and consent.
- CRM v1 data model is now represented in the Supabase migration, canonical schema and TypeScript database types.
- `/es/campus/admin` now has a CRM command-center block that reads CRM tasks, opportunities and activity when the migration is applied, with a safe pending-migration fallback.
- Lead status updates now sync to CRM opportunities, contact lifecycle and CRM activity timeline when CRM tables exist.
- Admin student detail now acts as the first central CRM record: CRM contact state, open pipeline, open tasks and a unified timeline combining CRM activity, payments, classes and support tickets.
- Admin navigation now points "Estudiantes" to `/campus/admin/students` and keeps the older assignment surface available as "Matching".
- CRM Leads now receives enriched CRM opportunity data when available and shows the opportunity stage next to the legacy lead status.
- CRM Leads now allows editing the CRM opportunity stage; stage changes sync legacy lead status, contact lifecycle, CRM activity timeline and admin audit log.
- Admin student detail now supports manual CRM notes and follow-up task creation. Both actions write CRM records and admin audit entries.
- CRM tasks now support completion, snooze, cancellation and editing from the shared admin task list. Task lifecycle changes write CRM timeline activity and admin audit entries.
- Support tickets, Stripe payment records and class scheduling/state changes now write persistent CRM activities when CRM tables exist. These writes are safe fallbacks: operational flows continue if the CRM migration is not applied yet.
- The admin student timeline now avoids double-rendering operational fallback rows when a persisted CRM activity already exists for the same payment, support ticket or class event.
- Admin student detail now shows CRM consent/preference rows and allows admins to register or update legal basis by channel/purpose, plus record opt-out. These actions write CRM timeline activity and admin audit entries.
- `/es/campus/admin` is now a daily command center, not just a summary: it shows urgent count, overdue CRM tasks, new leads, open support tickets, failed payments, subscriptions ending in 14 days and today's scheduled classes, with links to the admin surface where each item is resolved.
- CRM contacts without a campus profile now have a central admin ficha at `/campus/admin/crm/contact/:id`; enriched leads and CRM dashboard opportunity/activity links can open that ficha instead of falling back to the leads table.
- Open CRM opportunities are now editable from the central CRM contact ficha and from the student ficha. Stage changes use the same shared admin action as the pipeline: they sync contact lifecycle, legacy lead status, CRM timeline activity and admin audit log.
- Failed payments can now be converted into CRM recovery tasks from the daily command center and payments surface. The task is linked to the payment through related-entity fields, updates the contact follow-up date, writes CRM activity and records an admin audit entry.
- Open support tickets can now be triaged or closed directly from the daily command center. The action reuses the admin support endpoint, so it keeps the existing support activity sync and admin audit log behavior.
- Ending active subscriptions can now be converted into CRM renewal tasks from the daily command center. The task is linked to the subscription, updates the contact follow-up date, writes CRM activity and records an admin audit entry.
- `/es/campus/admin` now includes a first decision-oriented CRM report: retention/payment risk. It groups failed payments, ending subscriptions and open student support tickets by student, scores urgency and estimates revenue at risk.
- `/es/campus/admin/leads` now receives a server-side conversion summary independent of the visible status filter. It shows source-path performance, declared interest/plan/level and CRM stage distribution across recent leads, so the pipeline page can answer which routes and stages are actually moving.
- Contact/student fichas now distinguish internal notes from real manual communications. Email, call and WhatsApp logs write typed CRM activities, update `last_contacted_at`, and require a valid latest consent row or an explicit review reason for outbound sales/marketing contact. Opt-out blocks the log.
- CRM privacy operations now have a dedicated runbook at `docs/crm/privacy-operations.md`: rights workflow, data map, consent/opt-out rules, retention placeholders and production gaps for legal review.
- CRM verification evidence is recorded in `docs/crm/verification.md`, including passed checks, known Playwright auth caveat and accepted non-goals.
- Import batches and email campaigns for old student lists remain deferred; the user has explicitly chosen not to use those emails for now.

## Next Implementation Slice

1. Add owner/shared-queue filtering only when the partner starts using the admin regularly.
2. Add one-off outbound email sending only after consent checks are enforced in the send path.
3. Keep visual snapshot guard active after every UI change.
