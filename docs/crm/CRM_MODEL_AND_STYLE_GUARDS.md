# CRM Model And Style Guards

This file is intentionally short. The canonical CRM model and implementation plan now live in:

- `docs/crm/custom-crm-model.md`
- `docs/crm/work-plan.md`

Keep this document as a pointer only so the project does not drift into two competing CRM specs.

## Current Decision

- The CRM remains inside the existing Astro/Supabase admin app.
- The central CRM record is `crm_contacts`.
- Pipeline is modeled with `crm_opportunities`.
- Follow-up work is modeled with `crm_tasks`.
- Relationship memory is modeled with `crm_activities`.
- Consent and opt-out rules are modeled with `crm_consents`.
- Import batches and email campaigns remain deferred until there is a real use case.

## Style Guard

The visual consistency method is:

1. Use existing admin design tokens in Tailwind/CSS.
2. Reuse admin components and primitives instead of new local styles.
3. Run the admin style guard after UI changes.
4. Keep Playwright visual snapshots for canonical admin routes.

This is the practical version of the requested "visual hash": token checks plus deterministic screenshot baselines.
