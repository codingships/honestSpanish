---
artifact: launch-products
version: "1.1"
created: 2026-05-29
updated: 2026-05-29
status: active
---

# Products And Pricing

Runtime source of truth: Supabase `packages`, managed from the admin CRM at `/es/campus/admin/packages`.

Planning rule: do not edit public pricing copy, Stripe prices, and database rows independently. The admin CRM updates Supabase and can synchronize Stripe recurring prices for 1, 3, and 6 month billing periods.

Operational fallback: Stripe synchronization can also be run from the command line:

```bash
pnpm exec tsx scripts/sync-stripe-packages.ts
pnpm exec tsx scripts/sync-stripe-packages.ts --apply
```

The first command is a dry run. The `--apply` command creates or updates Stripe Products/Prices and writes the resulting Price IDs back to Supabase. It does not create checkout sessions or charges.

## Launch Packages

Confirmed source: active production Supabase packages on 2026-05-29.

| Key | ES Name | Monthly Price | Classes/Month | Group | Dual Teacher | Status |
|---|---|---:|---:|---|---|---|
| `group` | Grupal Externo | 50 EUR | 4 | Yes | No | Active |
| `standard` | Mensual Estandar | 145 EUR | 4 | No | No | Active |
| `hybrid` | Hibrido Mensual | 150 EUR | 4 | Yes | Yes | Active |
| `bootcamp` | Intensivo Bootcamp | 345 EUR | 20 | No | No | Active |

Historical packages such as `essential`, `intensive`, and `premium` are not launch products unless explicitly reactivated.

## Billing Durations

The CRM creates/maintains recurring Stripe prices for:

| Duration | Stripe Model | Current Rule |
|---|---|---|
| 1 month | Recurring monthly price, interval count 1 | 100% of monthly price |
| 3 months | Recurring monthly price, interval count 3 | 10% discount on total period |
| 6 months | Recurring monthly price, interval count 6 | 20% discount on total period |

Stripe prices are immutable. When price, duration, or recurrence changes, the CRM creates a new Stripe Price ID and deactivates the old active price where possible.

Safety behavior: saving a changed monthly price clears the stored Stripe Price IDs. This disables checkout for that package until Stripe synchronization creates replacement recurring prices.

## Class Duration

Commercial promise: classes are sold as 55 minute classes.

Code behavior:

- Default scheduled class duration is 55 minutes.
- Calendar availability and Google Calendar event length use the scheduled duration.
- Google Meet is not cut off automatically by the platform at minute 55.
- Admin can still schedule different durations when operationally needed.

## Launch Blockers

- [ ] Run the 009 migration in production before relying on package audit logs or fulfillment jobs.
- [x] Synchronize Stripe recurring prices for all active launch packages in the current Stripe test mode.
- [x] Verify authenticated checkout returns a Stripe Checkout URL in the current Stripe test mode.
- [ ] Verify public copy in ES/EN/RU matches these four packages and does not promise incompatible quotas.
- [ ] Repeat/verify Stripe synchronization in the intended live Stripe mode before production checkout.
- [ ] Verify checkout is available only for active packages with all required Stripe price IDs.

## Admin Safety Rules

- Save package changes before synchronizing Stripe.
- After a price change, synchronize Stripe before treating the package as checkout-ready.
- Treat active packages without complete Stripe prices as not ready for checkout.
- Do not edit Stripe prices manually unless the matching Supabase `packages` row is updated afterwards.
- Keep inactive legacy packages inactive unless there is a deliberate migration plan.
