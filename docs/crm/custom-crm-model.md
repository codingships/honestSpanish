# Custom CRM Model

## Decision

Español Honesto keeps the CRM inside the Astro/Supabase admin app. It uses standard CRM primitives: contacts, lifecycle, pipeline, activities, tasks, consent/provenance, timeline, reporting and operational queues.

## Current Admin Shape

Keep `/es/campus/admin` as the daily command center:

- Urgent tasks and overdue follow-ups.
- New leads not contacted.
- Open support tickets.
- Failed payments.
- Subscriptions ending soon.
- Today's classes and first-class risks.
- Retention/payment risk grouped by student.

The daily command center is deliberately a work queue, not a vanity dashboard. Each queue item should either be actionable in place or link to the admin surface where the action happens:

- CRM tasks -> shared task actions and contact/student detail.
- New leads -> CRM Leads pipeline, then central CRM contact detail when a contact exists.
- CRM opportunities -> editable stage control in CRM Leads, central CRM contact detail and student detail.
- Lead source/stage reporting -> CRM Leads pipeline, with server-side summary not tied to the current table filter.
- Support tickets -> quick triage/close actions in the daily command center, with Admin Support for full context.
- Failed payments -> payment/student detail.
- Ending subscriptions -> CRM renewal task, student detail and renewal decision.
- Today's classes -> Admin Calendar.
- Retention/payment risk -> student detail, recovery task, renewal task or support triage depending on the signal.

Use the existing admin routes for relationship work first:

- Contacts.
- Pipeline.
- Tasks.
- Consent and communication preferences.

Keep import batches as a later option only if old email lists become relevant again.

Keep existing academic operations separate but connected:

- Students.
- Teacher assignment.
- Calendar.
- Payments.
- Support.
- Jobs.

## Standard CRM Concepts

Use one central person record.

- `profile`: authentication and campus user account.
- `crm_contact`: the business relationship record. Can exist before login, after login, for old students, or for inactive contacts.
- `crm_opportunity`: a possible purchase/enrollment conversation.
- `crm_activity`: what happened with the contact.
- `crm_task`: what we must do next.
- `crm_consent`: why and how we are allowed to contact this person.

Do not treat "lead" and "student" as separate humans. A lead can become a student; the contact should remain the same.

CRM tasks may also point to an operational record through optional related-entity fields. That is useful for work such as failed payment recovery, where the task belongs to the relationship but must remain linked to the exact payment that created the risk.

Admin detail routes should follow that same rule:

- `/campus/admin/crm/contact/:id` is the central relationship file for any CRM contact, including leads without a campus account.
- `/campus/admin/student/:id` remains the operational student file when the contact has a linked `profile_id`.

## Data Model

### `crm_contacts`

Central record for any person the business relates to.

- `id uuid primary key`
- `profile_id uuid null references profiles(id)`
- `primary_email text not null`
- `full_name text null`
- `phone text null`
- `preferred_language text`
- `timezone text`
- `country text null`
- `lifecycle_stage text check in ('lead','qualified','customer','alumni','inactive','lost')`
- `source text null`
- `source_path text null`
- `owner_id uuid null references profiles(id)`
- `last_contacted_at timestamptz null`
- `next_follow_up_at timestamptz null`
- `created_at timestamptz`
- `updated_at timestamptz`

Recommended indexes:

- unique lower email index.
- lifecycle + next follow-up index.
- profile_id index.
- owner_id index.

### `crm_opportunities`

Enrollment/sales pipeline. For this business, an opportunity is usually "this person may buy a plan".

- `id uuid primary key`
- `contact_id uuid references crm_contacts(id)`
- `stage text check in ('new','to_contact','contacted','qualified','proposal','won','lost','nurture')`
- `interest text null`
- `current_level text null`
- `learning_goal text null`
- `availability text null`
- `preferred_package_id uuid null references packages(id)`
- `expected_value_cents integer null`
- `probability integer null`
- `lost_reason text null`
- `converted_subscription_id uuid null references subscriptions(id)`
- `assigned_to uuid null references profiles(id)`
- `opened_at timestamptz`
- `closed_at timestamptz null`
- `created_at timestamptz`
- `updated_at timestamptz`

Recommended indexes:

- contact_id index.
- partial index for open stages.
- assigned_to + stage index.

### `crm_tasks`

Follow-up and daily work queue.

- `id uuid primary key`
- `contact_id uuid references crm_contacts(id)`
- `opportunity_id uuid null references crm_opportunities(id)`
- `assigned_to uuid references profiles(id)`
- `title text not null`
- `task_type text check in ('email','call','whatsapp','review','admin')`
- `priority text check in ('low','normal','high','urgent')`
- `status text check in ('open','done','snoozed','cancelled')`
- `due_at timestamptz`
- `completed_at timestamptz null`
- `related_entity_type text null`
- `related_entity_id text null`
- `metadata jsonb not null default '{}'`
- `created_at timestamptz`
- `updated_at timestamptz`

Recommended indexes:

- assigned_to + status + due_at index.
- partial index for open overdue tasks.
- related_entity_type + related_entity_id index for operational follow-up tasks.

### `crm_activities`

Timeline of the relationship. This is different from `admin_audit_log`: activity is business memory; audit log is system accountability.

- `id uuid primary key`
- `contact_id uuid references crm_contacts(id)`
- `opportunity_id uuid null references crm_opportunities(id)`
- `actor_id uuid null references profiles(id)`
- `activity_type text check in ('note','email_in','email_out','call','whatsapp','meeting','support','payment','class','system')`
- `subject text null`
- `body text null`
- `occurred_at timestamptz`
- `metadata jsonb not null default '{}'`
- `related_entity_type text null`
- `related_entity_id text null`
- `created_at timestamptz`

Recommended indexes:

- contact_id + occurred_at descending index.
- activity_type + occurred_at index.

### `crm_consents`

Legal/provenance layer for contacting people.

- `id uuid primary key`
- `contact_id uuid references crm_contacts(id)`
- `channel text check in ('email','phone','whatsapp')`
- `purpose text check in ('transactional','support','marketing','sales_follow_up')`
- `legal_basis text check in ('consent','contract','prior_customer_similar_services','legitimate_interest','manual_review_required')`
- `source text null`
- `proof text null`
- `notice_version text null`
- `captured_at timestamptz null`
- `opted_out_at timestamptz null`
- `created_at timestamptz`
- `updated_at timestamptz`

Recommended indexes:

- contact_id index.
- channel + purpose + opted_out_at index.

### `crm_import_batches`

Tracks where old email lists came from.

- `id uuid primary key`
- `name text not null`
- `source_description text not null`
- `imported_by uuid references profiles(id)`
- `legal_review_status text check in ('pending','approved','rejected')`
- `created_at timestamptz`

### `crm_import_batch_contacts`

Many-to-many link between imports and contacts.

- `batch_id uuid references crm_import_batches(id)`
- `contact_id uuid references crm_contacts(id)`
- `row_metadata jsonb not null default '{}'`
- primary key `(batch_id, contact_id)`

## Existing Tables To Keep

Keep these tables as operational/domain tables and connect them into CRM views:

- `profiles`
- `profiles_private`
- `leads`, initially migrated into `crm_contacts` + `crm_opportunities`
- `subscriptions`
- `payments`
- `sessions`
- `student_teachers`
- `support_tickets`
- `fulfillment_jobs`
- `admin_audit_log`

Operational tables remain the source of truth for their domain. The CRM does not replace them; it records relationship memory in `crm_activities`:

- opportunity stage changed -> system activity plus admin audit log entry.
- support ticket created/updated -> support activity.
- Stripe payment succeeded/failed -> payment activity.
- failed payment recovery task created -> CRM task, CRM activity and admin audit log entry.
- active subscription nearing its end -> CRM renewal task, CRM activity and admin audit log entry.
- class scheduled/cancelled/completed/no-show -> class activity.
- manual internal notes -> `note` CRM activity records.
- manual email/call/WhatsApp logs -> typed CRM activity records with channel, direction, purpose and consent-review metadata.
- manual tasks -> CRM-native task records.
- consent/base legal updates and opt-outs -> CRM-native activity records plus audit log entries.

No outbound sales/marketing workflow should send or log contact without checking the latest `crm_consents` row for that channel and purpose. Opt-out blocks the action. If the latest row is missing or has `manual_review_required`, the safe default is manual review; manual logs may continue only with an explicit review reason, while future send paths must enforce a stricter approval gate.

Operational privacy procedures live in `docs/crm/privacy-operations.md`. Product and legal decisions that still require the owner are listed in `docs/PRODUCT.md`.
