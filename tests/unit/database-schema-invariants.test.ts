import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const schema = readFileSync('db/schema.sql', 'utf8').replace(/\r\n/g, '\n');
const profileHardeningMigration = readFileSync('supabase/migrations/005_harden_profile_updates_and_rpc.sql', 'utf8').replace(/\r\n/g, '\n');
const schemaDriftMigration = readFileSync('supabase/migrations/006_reconcile_schema_drift.sql', 'utf8').replace(/\r\n/g, '\n');
const leadEnrichmentMigration = readFileSync('supabase/migrations/018_enrich_leads_for_application.sql', 'utf8').replace(/\r\n/g, '\n');
const preferredPackageMigration = readFileSync('supabase/migrations/019_capture_preferred_package_on_leads.sql', 'utf8').replace(/\r\n/g, '\n');
const crmMigration = readFileSync('supabase/migrations/20260624163423_add_crm_core.sql', 'utf8').replace(/\r\n/g, '\n');
const leadLanguagesMigration = readFileSync('supabase/migrations/20260625213116_capture_lead_languages.sql', 'utf8').replace(/\r\n/g, '\n');
const levelCheckMigration = readFileSync('supabase/migrations/20260625215008_add_lightweight_level_check_to_leads.sql', 'utf8').replace(/\r\n/g, '\n');
const sessionWriteHardeningMigration = readFileSync('supabase/migrations/021_harden_session_write_policies.sql', 'utf8').replace(/\r\n/g, '\n');
const webhookProcessingMigration = readFileSync('supabase/migrations/022_track_stripe_webhook_processing_state.sql', 'utf8').replace(/\r\n/g, '\n');
const webhookProcessedAtDefaultMigration = readFileSync('supabase/migrations/20260703211451_drop_processed_webhook_processed_at_default.sql', 'utf8').replace(/\r\n/g, '\n');
const runtimeDriftReconciliationMigration = readFileSync('supabase/migrations/20260710133000_reconcile_runtime_schema_drift.sql', 'utf8').replace(/\r\n/g, '\n');
const billingCatalogMigration = readFileSync('supabase/migrations/20260710205031_harden_billing_catalog_and_checkout_approval.sql', 'utf8').replace(/\r\n/g, '\n');
const billingReconciliationMigration = readFileSync('supabase/migrations/20260710215712_harden_billing_reconciliation.sql', 'utf8').replace(/\r\n/g, '\n');
const checkoutRecoveryMigration = readFileSync('supabase/migrations/20260710221846_harden_checkout_orphan_recovery.sql', 'utf8').replace(/\r\n/g, '\n');
const checkoutSnapshotMigration = readFileSync('supabase/migrations/20260710223900_harden_checkout_customer_and_snapshot_immutability.sql', 'utf8').replace(/\r\n/g, '\n');
const sessionStatusContractMigration = readFileSync('supabase/migrations/20260712195500_harden_sessions_status_contract.sql', 'utf8').replace(/\r\n/g, '\n');
const versionedOfferMigration = readFileSync('supabase/migrations/20260731151309_add_versioned_28_day_individual_offer.sql', 'utf8').replace(/\r\n/g, '\n');
const bookableSlotsMigration = readFileSync('supabase/migrations/20260731185233_add_bookable_slots_and_holds.sql', 'utf8').replace(/\r\n/g, '\n');
const checkoutV2BillingMigration = readFileSync('supabase/migrations/20260731225000_add_checkout_v2_billing_foundation.sql', 'utf8').replace(/\r\n/g, '\n');
const catalogV2AdminMigration = readFileSync('supabase/migrations/20260803171044_catalog_v2_admin_drafts.sql', 'utf8').replace(/\r\n/g, '\n');
const checkoutV2MaterializationMigration = readFileSync('supabase/migrations/20260801120000_materialize_checkout_v2_cycle_sessions.sql', 'utf8').replace(/\r\n/g, '\n');
const checkoutHoldProtectionMigration = readFileSync('supabase/migrations/20260801130000_protect_checkout_v2_slot_holds.sql', 'utf8').replace(/\r\n/g, '\n');
const checkoutPolicyRotationMigration = readFileSync('supabase/migrations/20260802014725_rotate_checkout_intent_legal_policy_version.sql', 'utf8').replace(/\r\n/g, '\n');
const checkoutV2CycleFulfillmentMigration = readFileSync('supabase/migrations/20260801140000_enqueue_checkout_v2_cycle_fulfillment.sql', 'utf8').replace(/\r\n/g, '\n');
const checkoutV2RescheduleMigration = readFileSync('supabase/migrations/20260801150000_add_checkout_v2_reschedule_operations.sql', 'utf8').replace(/\r\n/g, '\n');
const checkoutV2RescheduleTargetsMigration = readFileSync('supabase/migrations/20260801160000_checkout_v2_reschedule_targets.sql', 'utf8').replace(/\r\n/g, '\n');
const crmNoShowIdempotencyMigration = readFileSync('supabase/migrations/20260802034445_add_crm_no_show_idempotency.sql', 'utf8').replace(/\r\n/g, '\n');
const checkoutV2ReplacementLineageMigration = readFileSync('supabase/migrations/20260802034119_add_checkout_v2_replacement_lineage.sql', 'utf8').replace(/\r\n/g, '\n');
const stripeWebhookRoute = readFileSync('src/pages/api/stripe-webhook.ts', 'utf8').replace(/\r\n/g, '\n');
const profileRoleTriggerMigration = readFileSync('supabase/migrations/20260702124757_harden_profile_role_trigger.sql', 'utf8').replace(/\r\n/g, '\n');
const databaseTypes = readFileSync('src/types/database.types.ts', 'utf8').replace(/\r\n/g, '\n');

function canonicalSqlFunction(source: string, qualifiedName: string): string {
    const startMarker = `CREATE OR REPLACE FUNCTION ${qualifiedName}`;
    const start = source.indexOf(startMarker);
    if (start < 0) throw new Error(`Missing SQL function: ${qualifiedName}`);

    const end = source.indexOf('\n$$;', start);
    if (end < 0) throw new Error(`Unterminated SQL function: ${qualifiedName}`);

    return source.slice(start, end + '\n$$;'.length).replace(/\s+/g, ' ').trim();
}

function canonicalLatestSqlFunction(source: string, qualifiedName: string): string {
    const startMarker = `CREATE OR REPLACE FUNCTION ${qualifiedName}`;
    const start = source.lastIndexOf(startMarker);
    if (start < 0) throw new Error(`Missing SQL function: ${qualifiedName}`);

    const end = source.indexOf('\n$$;', start);
    if (end < 0) throw new Error(`Unterminated SQL function: ${qualifiedName}`);

    return source.slice(start, end + '\n$$;'.length).replace(/\s+/g, ' ').trim();
}

describe('database schema security invariants', () => {
    it('uses separate durable idempotency keys for no-show tasks and activities', () => {
        for (const snippet of [
            'ADD COLUMN IF NOT EXISTS idempotency_key TEXT',
            "'crm:no-show-follow-up:task:' || task.related_entity_id",
            "'crm:no-show-follow-up:activity:' || activity.related_entity_id",
            "'crm:session-outcome:activity:'",
            "'crm:first-class-completed:activity:'",
            "WHEN status = 'open' THEN 0",
            "WHEN status = 'snoozed' THEN 1",
            'CREATE UNIQUE INDEX IF NOT EXISTS crm_tasks_idempotency_key_unique_idx',
            'CREATE UNIQUE INDEX IF NOT EXISTS crm_activities_idempotency_key_unique_idx',
            'CREATE OR REPLACE FUNCTION public.refresh_crm_no_show_contact_alarm(',
            "SET search_path = ''",
            'FOR UPDATE;',
            "task_status <> 'open'",
            'FROM PUBLIC, anon, authenticated;',
            'TO service_role;',
        ]) {
            expect(crmNoShowIdempotencyMigration).toContain(snippet);
        }

        expect(schema).toContain('CREATE UNIQUE INDEX crm_tasks_idempotency_key_unique_idx ON crm_tasks(idempotency_key);');
        expect(schema).toContain('CREATE UNIQUE INDEX crm_activities_idempotency_key_unique_idx ON crm_activities(idempotency_key);');
        expect(databaseTypes.match(/^\s+idempotency_key: string \| null;/gm)).toHaveLength(2);
        expect(databaseTypes.match(/^\s+idempotency_key\?: string \| null;/gm)).toHaveLength(4);
        expect(databaseTypes).toContain('refresh_crm_no_show_contact_alarm: {');
        expect(schema).toContain('CREATE OR REPLACE FUNCTION public.refresh_crm_no_show_contact_alarm(');
    });

    it('bootstraps is_admin before later migrations create dependent policies', () => {
        expect(profileHardeningMigration).toContain('CREATE OR REPLACE FUNCTION public.is_admin()');
        expect(profileHardeningMigration).toContain('SECURITY DEFINER');
        expect(profileHardeningMigration).toContain('SET search_path = public');
        expect(profileHardeningMigration).toContain('REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC');
        expect(profileHardeningMigration).toContain('GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated');
        expect(schemaDriftMigration).toContain('ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()');
    });

    it('protects profile role and email from direct authenticated profile updates', () => {
        expect(schema).toContain('CREATE OR REPLACE FUNCTION private.protect_profile_role()');
        expect(schema).toContain('CREATE TRIGGER protect_profile_role_trigger');
        expect(schema).toContain('NEW.role IS DISTINCT FROM OLD.role');
        expect(schema).toContain('NEW.email IS DISTINCT FROM OLD.email');
        expect(schema).toContain('Cannot modify role');
        expect(schema).toContain('Cannot modify profile email');
        expect(schema).toContain('FOR EACH ROW EXECUTE FUNCTION private.protect_profile_role()');
        expect(schema).toContain('REVOKE ALL ON FUNCTION private.protect_profile_role() FROM public');
        expect(schema).not.toContain('CREATE OR REPLACE FUNCTION public.protect_profile_role()');

        for (const snippet of [
            'CREATE SCHEMA IF NOT EXISTS private',
            'DROP TRIGGER IF EXISTS protect_profile_role_trigger ON public.profiles',
            'DROP FUNCTION IF EXISTS public.protect_profile_role()',
            'CREATE OR REPLACE FUNCTION private.protect_profile_role()',
            "IF (select private.is_admin()) THEN",
            'NEW.role IS DISTINCT FROM OLD.role',
            'NEW.email IS DISTINCT FROM OLD.email',
            "RAISE EXCEPTION 'Cannot modify profile email'",
            'REVOKE ALL ON FUNCTION private.protect_profile_role() FROM public',
            'REVOKE ALL ON FUNCTION private.protect_profile_role() FROM anon',
            'REVOKE ALL ON FUNCTION private.protect_profile_role() FROM authenticated',
            'CREATE TRIGGER protect_profile_role_trigger',
            'FOR EACH ROW EXECUTE FUNCTION private.protect_profile_role()',
        ]) {
            expect(profileRoleTriggerMigration).toContain(snippet);
        }
    });

    it('keeps get_available_slots in the canonical schema and callable only by service_role', () => {
        expect(schema).toContain('CREATE OR REPLACE FUNCTION get_available_slots');
        expect(schema).toContain('SECURITY DEFINER');
        expect(schema).toContain('SET search_path = public');
        expect(schema).toContain('REVOKE EXECUTE ON FUNCTION get_available_slots(UUID, DATE, INTEGER) FROM anon');
        expect(schema).toContain('REVOKE EXECUTE ON FUNCTION get_available_slots(UUID, DATE, INTEGER) FROM authenticated');
        expect(schema).toContain('GRANT EXECUTE ON FUNCTION get_available_slots(UUID, DATE, INTEGER) TO service_role');

        for (const snippet of [
            'CREATE OR REPLACE FUNCTION public.get_available_slots',
            'p_duration_minutes INTEGER DEFAULT 50',
            'SECURITY DEFINER',
            'SET search_path = public',
            'REVOKE EXECUTE ON FUNCTION public.get_available_slots(UUID, DATE, INTEGER) FROM anon',
            'REVOKE EXECUTE ON FUNCTION public.get_available_slots(UUID, DATE, INTEGER) FROM authenticated',
            'GRANT EXECUTE ON FUNCTION public.get_available_slots(UUID, DATE, INTEGER) TO service_role',
            'RENAME CONSTRAINT leads_email_unique TO leads_email_key',
            'ADD CONSTRAINT leads_email_key UNIQUE (email)',
            'duplicate lead emails exist',
        ]) {
            expect(runtimeDriftReconciliationMigration).toContain(snippet);
        }
    });

    it('keeps student and teacher sessions writes behind server-side workflows', () => {
        expect(schema).not.toContain('ON sessions FOR ALL \n    USING (teacher_id = auth.uid())');
        expect(schema).not.toContain('CREATE POLICY "Students can cancel own sessions"');
        expect(schema).not.toContain('CREATE POLICY "Teachers can create assigned sessions"');
        expect(schema).not.toContain('CREATE POLICY "Teachers can update assigned sessions"');
        expect(schema).toContain('CREATE POLICY "Teachers can view assigned sessions"');
        expect(schema).toContain('CREATE POLICY "Students can view own sessions"');
        expect(schema).toContain('ON sessions FOR SELECT');

        for (const snippet of [
            'DROP POLICY IF EXISTS "Students can cancel own sessions" ON sessions',
            'DROP POLICY IF EXISTS "Teachers can create assigned sessions" ON sessions',
            'DROP POLICY IF EXISTS "Teachers can update assigned sessions" ON sessions',
            'DROP POLICY IF EXISTS "Teachers can view and update assigned sessions" ON sessions',
            'CREATE POLICY "Teachers can view assigned sessions"',
            'ON sessions FOR SELECT',
        ]) {
            expect(sessionWriteHardeningMigration).toContain(snippet);
        }

    });

    it('makes the session status contract non-null and reproducible from migrations', () => {
        expect(schema).toContain("status TEXT NOT NULL DEFAULT 'scheduled' CHECK");
        for (const snippet of [
            'LOCK TABLE public.sessions IN ACCESS EXCLUSIVE MODE',
            "WHERE status IS NULL",
            "status NOT IN ('scheduled', 'completed', 'cancelled', 'no_show')",
            'DROP CONSTRAINT IF EXISTS sessions_status_check',
            'ADD CONSTRAINT sessions_status_check',
            "ALTER COLUMN status SET DEFAULT 'scheduled'",
            'ALTER COLUMN status SET NOT NULL',
        ]) {
            expect(sessionStatusContractMigration).toContain(snippet);
        }
        expect(databaseTypes).toContain('status: string;');
        expect(databaseTypes).toContain('status?: string;');
    });

    it('tracks Stripe webhook processing state across known live schema drift', () => {
        expect(schema).toContain('processed_at TIMESTAMPTZ,');
        expect(schema).not.toContain('processed_at TIMESTAMPTZ DEFAULT');

        for (const snippet of [
            'processing_status TEXT NOT NULL DEFAULT',
            'processing_error TEXT',
            'processed_at TIMESTAMPTZ',
        ]) {
            expect(schema).toContain(snippet);
        }

        for (const snippet of [
            'ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()',
            'ADD COLUMN IF NOT EXISTS processing_status TEXT',
            'ADD COLUMN IF NOT EXISTS processing_error TEXT',
            'ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ',
            "processing_status = COALESCE(processing_status, 'succeeded')",
            'created_at = COALESCE(created_at, processed_at, NOW())',
            'processed_at = COALESCE(processed_at, created_at, NOW())',
            "CHECK (processing_status IN ('processing', 'succeeded', 'failed'))",
        ]) {
            expect(webhookProcessingMigration).toContain(snippet);
        }

        for (const snippet of [
            'processed_at: string | null',
            'processing_error: string | null',
            'processing_status: string',
        ]) {
            expect(databaseTypes).toContain(snippet);
        }

        expect(webhookProcessedAtDefaultMigration).toContain('ALTER TABLE public.processed_webhook_events');
        expect(webhookProcessedAtDefaultMigration).toContain('ALTER COLUMN processed_at DROP DEFAULT');
    });

    it('keeps Stripe webhook processing claims unprocessed until success', () => {
        for (const snippet of [
            "processing_status: 'processing'",
            'processing_error: null',
            'processed_at: null',
            'markWebhookEventSucceeded',
            'processed_at: new Date().toISOString()',
            'markWebhookEventFailed',
        ]) {
            expect(stripeWebhookRoute).toContain(snippet);
        }
    });

    it('keeps billing offers, checkout authorization and renewals immutable and atomic', () => {
        for (const snippet of [
            'CREATE TABLE IF NOT EXISTS public.package_prices',
            'CREATE TABLE IF NOT EXISTS public.checkout_intents',
            'package_prices_one_active_duration_idx',
            'checkout_intents_one_open_per_student_idx',
            'subscriptions_stripe_subscription_unique_idx',
            'payments_stripe_invoice_unique_idx',
            'CREATE OR REPLACE FUNCTION public.claim_checkout_intent',
            'CREATE OR REPLACE FUNCTION public.complete_checkout_intent',
            'CREATE OR REPLACE FUNCTION public.release_expired_checkout_intent',
            'CREATE OR REPLACE FUNCTION public.activate_package_price',
            'CREATE OR REPLACE FUNCTION public.apply_subscription_renewal',
            'CREATE OR REPLACE FUNCTION public.reconcile_stripe_refund',
            "status IN ('creating', 'open')",
            "claim_time + INTERVAL '1 hour'",
            "claim_time + INTERVAL '2 hours'",
            'contracted_sessions_per_period',
            'package_price_commercial_fields_are_immutable',
            'open_checkout_intent_must_finish_or_expire_first',
            'REVOKE ALL ON TABLE public.checkout_intents FROM PUBLIC, anon, authenticated',
            'REVOKE ALL ON TABLE public.package_prices FROM PUBLIC, anon, authenticated',
        ]) {
            expect(billingCatalogMigration).toContain(snippet);
        }

        for (const snippet of [
            'CREATE TABLE package_prices',
            'CREATE TABLE checkout_intents',
            'CREATE OR REPLACE FUNCTION public.claim_checkout_intent',
            'CREATE OR REPLACE FUNCTION public.complete_checkout_intent',
            'CREATE OR REPLACE FUNCTION public.release_expired_checkout_intent',
            'CREATE OR REPLACE FUNCTION public.apply_subscription_renewal',
            'CREATE OR REPLACE FUNCTION public.reconcile_stripe_refund',
        ]) {
            expect(schema).toContain(snippet);
        }
    });

    it('adds the inactive 28-day contract without reinterpreting legacy monthly offers', () => {
        for (const snippet of [
            'contract_schema_version SMALLINT NOT NULL DEFAULT 1',
            'is_publicly_listed BOOLEAN NOT NULL DEFAULT FALSE',
            'packages_id_contract_schema_version_key',
            'package_prices_package_contract_version_fkey',
            'FOREIGN KEY (package_id, contract_schema_version)',
            'package_prices_one_active_v2_offer_idx',
            'CREATE OR REPLACE FUNCTION private.populate_legacy_contract_interval()',
            "NEW.billing_interval_unit := 'month'",
            'NEW.billing_interval_count := NEW.duration_months',
            'package_price_versioned_contract_is_immutable',
            'versioned_package_contract_fields_are_immutable',
            'subscription_versioned_contract_is_immutable',
            'CREATE OR REPLACE FUNCTION public.activate_versioned_package_price',
            'SECURITY DEFINER',
            'GRANT EXECUTE ON FUNCTION public.activate_versioned_package_price',
            'CREATE POLICY "Anyone can view publicly listed packages"',
            "'individual_4x50_28d'",
            '25900',
            "'day'",
            '28',
            '50',
            'ON CONFLICT (name) DO NOTHING',
        ]) {
            expect(versionedOfferMigration).toContain(snippet);
            expect(schema).toContain(snippet === 'ON CONFLICT (name) DO NOTHING'
                ? "'individual_4x50_28d'"
                : snippet);
        }

        expect(versionedOfferMigration).toContain('ALTER COLUMN duration_months DROP NOT NULL');
        expect(versionedOfferMigration).toContain('contract_schema_version = 1');
        expect(versionedOfferMigration).toContain("billing_interval_unit = 'month'");
        expect(versionedOfferMigration).toContain('billing_interval_count = duration_months');
        expect(versionedOfferMigration).toContain('contract_schema_version = 2');
        expect(versionedOfferMigration).toContain('duration_months IS NULL');
        expect(versionedOfferMigration).toContain('sessions_per_month IS NULL');
        expect(versionedOfferMigration).toContain('amount_cents IS NOT NULL AND amount_cents > 0');
        expect(versionedOfferMigration).toContain('price_monthly = amount_cents');
        expect(versionedOfferMigration).toContain('sessions_per_month = sessions_per_period');
        expect(versionedOfferMigration).toContain('billing_interval_count IS NOT NULL AND billing_interval_count > 0');
        expect(versionedOfferMigration).toContain('class_duration_minutes IS NOT NULL AND class_duration_minutes > 0');
        expect(versionedOfferMigration).toContain('is_publicly_listed = TRUE');
        expect(versionedOfferMigration).not.toContain('UPDATE public.packages\nSET name =');
        expect(versionedOfferMigration).not.toContain('DELETE FROM public.packages');
        expect(versionedOfferMigration).not.toContain('stripe.products');
        expect(versionedOfferMigration).not.toContain('stripe.prices');

        expect(schema).toContain('"ru":"4 индивидуальных занятия"');
        expect(databaseTypes).toContain('contract_schema_version: number;');
        expect(databaseTypes).toContain('is_publicly_listed: boolean;');
        expect(databaseTypes).toContain('billing_interval_unit: string | null;');
        expect(databaseTypes).toContain('activate_versioned_package_price: {');

        for (const functionName of [
            'private.populate_legacy_contract_interval()',
            'private.guard_versioned_package_contract()',
            'private.version_package_catalog()',
            'private.guard_versioned_package_price_history()',
            'private.guard_versioned_subscription_contract()',
            'public.activate_versioned_package_price(',
        ]) {
            expect(canonicalSqlFunction(schema, functionName)).toBe(
                canonicalSqlFunction(versionedOfferMigration, functionName)
            );
        }

        const versionedActivation = canonicalSqlFunction(
            versionedOfferMigration,
            'public.activate_versioned_package_price(',
        );
        expect(versionedActivation).toContain('SECURITY DEFINER');
        expect(versionedActivation).not.toContain('SECURITY INVOKER');
    });

    it('models sellable weekly slots and checkout-scoped holds without opening the offer', () => {
        for (const snippet of [
            'CREATE TABLE public.bookable_slots',
            'CREATE TABLE public.bookable_slot_occurrences',
            'CREATE TABLE public.bookable_slot_holds',
            'ADD COLUMN checkout_intent_id UUID',
            'subscriptions_checkout_intent_unique_idx',
            "timezone_name TEXT NOT NULL CHECK (timezone_name = 'Europe/Madrid')",
            'session_id UUID UNIQUE REFERENCES public.sessions(id) ON DELETE RESTRICT',
            "status IN ('draft', 'available', 'paused', 'sold', 'retired')",
            "status IN ('held', 'consumed', 'expired', 'released')",
            'bookable_slot_occurrences_teacher_overlap_excl',
            'bookable_slot_holds_one_live_hold_idx',
            'CREATE OR REPLACE FUNCTION private.guard_subscription_checkout_binding()',
            'CREATE OR REPLACE FUNCTION private.guard_bookable_slot_contract()',
            'CREATE OR REPLACE FUNCTION private.guard_bookable_slot_occurrence()',
            'CREATE OR REPLACE FUNCTION private.validate_bookable_slot_occurrences()',
            'CREATE OR REPLACE FUNCTION private.guard_session_against_bookable_slots()',
            'CREATE OR REPLACE FUNCTION private.guard_bookable_slot_hold()',
            'CREATE OR REPLACE FUNCTION private.validate_versioned_checkout_slot_hold()',
            'CREATE OR REPLACE FUNCTION public.create_bookable_slot(',
            'CREATE OR REPLACE FUNCTION public.publish_bookable_slot(',
            'CREATE OR REPLACE FUNCTION public.hold_bookable_slot(',
            'CREATE OR REPLACE FUNCTION public.claim_checkout_intent_for_slot(',
            'CREATE OR REPLACE FUNCTION public.release_bookable_slot_hold(',
            'CREATE OR REPLACE FUNCTION public.consume_bookable_slot_hold(',
            'CREATE OR REPLACE FUNCTION public.materialize_bookable_slot_sessions(',
            'DEFERRABLE INITIALLY DEFERRED',
            'AT TIME ZONE slot_row.timezone_name',
            "ARRAY[1, 2, 3, 4]::SMALLINT[]",
            "package_row.name <> 'individual_4x50_28d'",
            "package_row.billing_interval_unit <> 'day'",
            'package_row.billing_interval_count <> 28',
            'package_row.sessions_per_period <> 4',
            'package_row.class_duration_minutes <> 50',
            'public.claim_checkout_intent(',
            'PERFORM public.hold_bookable_slot(p_slot_id, intent_row.id)',
            "RAISE EXCEPTION 'versioned_subscription_requires_checkout_binding'",
            "RAISE EXCEPTION 'versioned_checkout_requires_bookable_slot_hold'",
            'subscription_row.checkout_intent_id IS DISTINCT FROM intent_row.id',
            'slot_row.first_occurrence_at <= intent_row.expires_at',
            'NEW.ends_at IS DISTINCT FROM NEW.starts_at + 28',
            'UPDATE public.subscriptions',
            'SET sessions_used = 4',
            "package_row.name <> 'individual_4x50_28d'",
            "price_row.amount_cents <> 25900",
            "SECURITY DEFINER",
            'REVOKE ALL ON TABLE public.bookable_slots',
            'REVOKE ALL ON TABLE public.bookable_slot_occurrences',
            'REVOKE ALL ON TABLE public.bookable_slot_holds',
            'GRANT SELECT ON TABLE public.bookable_slots TO service_role',
            'GRANT SELECT ON TABLE public.bookable_slot_occurrences TO service_role',
            'GRANT SELECT ON TABLE public.bookable_slot_holds TO service_role',
            'SET search_path = \'\'',
        ]) {
            expect(bookableSlotsMigration).toContain(snippet);
            expect(schema).toContain(snippet);
        }

        expect(bookableSlotsMigration).toContain('cardinality(p_occurrences) <> 4');
        expect(bookableSlotsMigration).toContain('expires_at IS DISTINCT FROM intent_row.expires_at');
        expect(bookableSlotsMigration).toContain("stale_intent.status = 'expired'");
        expect(bookableSlotsMigration).toContain("intent_row.status <> 'expired'");
        expect(bookableSlotsMigration).toContain('pg_catalog.pg_advisory_xact_lock');
        expect(bookableSlotsMigration).toContain('scheduled_session_overlaps_bookable_slot');
        expect(bookableSlotsMigration).toContain('bookable_slot_materialization_requires_four_exact_sessions');
        expect(bookableSlotsMigration).toContain('bookable_slot_occurrence_session_binding_is_invalid');
        expect(bookableSlotsMigration).toContain('COUNT(session_row.id) AS session_count');
        expect(bookableSlotsMigration).toContain('validate_versioned_checkout_slot_hold_after_write');
        expect(bookableSlotsMigration).toContain('bookable_slot_materialization_requires_unused_quota');
        expect(bookableSlotsMigration).toContain('materialized_bookable_slot_requires_consumed_quota');
        expect(bookableSlotsMigration).not.toContain('expires_at > now()');
        expect(bookableSlotsMigration).not.toContain('GRANT SELECT ON TABLE public.bookable_slots TO anon');
        expect(bookableSlotsMigration).not.toContain('GRANT EXECUTE ON FUNCTION public.hold_bookable_slot(UUID, UUID) TO authenticated');
        expect(bookableSlotsMigration).not.toContain('GRANT SELECT, INSERT, UPDATE ON TABLE public.bookable_slots');
        expect(bookableSlotsMigration).not.toContain('GRANT SELECT, INSERT, UPDATE ON TABLE public.bookable_slot_occurrences');
        expect(bookableSlotsMigration).not.toContain('GRANT SELECT, INSERT, UPDATE ON TABLE public.bookable_slot_holds');
        expect(bookableSlotsMigration).not.toContain('UPDATE public.packages');
        expect(bookableSlotsMigration).not.toContain('INSERT INTO public.package_prices');

        for (const typeSnippet of [
            'bookable_slot_holds: {',
            'bookable_slot_occurrences: {',
            'bookable_slots: {',
            'checkout_intent_id: string | null;',
            'claim_checkout_intent_for_slot: {',
            'consume_bookable_slot_hold: {',
            'create_bookable_slot: {',
            'hold_bookable_slot: {',
            'materialize_bookable_slot_sessions: {',
            'publish_bookable_slot: {',
            'release_bookable_slot_hold: {',
        ]) {
            expect(databaseTypes).toContain(typeSnippet);
        }

        for (const functionName of [
            'private.guard_subscription_checkout_binding()',
            'private.guard_bookable_slot_contract()',
            'private.guard_bookable_slot_occurrence()',
            'private.validate_bookable_slot_occurrences()',
            'private.sync_bookable_slot_occurrence_blocking()',
            'private.guard_bookable_slot_hold()',
            'private.validate_versioned_checkout_slot_hold()',
            'public.create_bookable_slot(',
            'public.publish_bookable_slot(',
            'public.hold_bookable_slot(',
            'public.claim_checkout_intent_for_slot(',
            'public.release_bookable_slot_hold(',
            'public.consume_bookable_slot_hold(',
            'public.materialize_bookable_slot_sessions(',
        ]) {
            expect(canonicalSqlFunction(schema, functionName)).toBe(
                canonicalSqlFunction(bookableSlotsMigration, functionName)
            );
        }

        expect(canonicalLatestSqlFunction(schema, 'private.guard_session_against_bookable_slots()')).toBe(
            canonicalLatestSqlFunction(checkoutV2RescheduleMigration, 'private.guard_session_against_bookable_slots()'),
        );
    });

    it('keeps Checkout V2 billing, four-date movement and weekly capacity atomic', () => {
        for (const snippet of [
            'CREATE TABLE public.checkout_v2_price_snapshots (',
            'CREATE TABLE public.checkout_v2_cycles (',
            'CREATE TABLE public.checkout_v2_billing_state (',
            'CREATE TABLE public.checkout_v2_weekly_allocations (',
            'stripe_price_id TEXT NOT NULL',
            "materialization_state IN ('pending', 'ready')",
            'sessions_materialized_at TIMESTAMPTZ',
            'checkout_v2_cycle_session_index SMALLINT',
            'sessions_checkout_v2_cycle_position_unique_idx',
            "ends_at = starts_at + INTERVAL '672 hours'",
            'checkout_v2_cycles_no_overlap_excl',
            'checkout_v2_weekly_capacity_excl',
            'CREATE OR REPLACE FUNCTION public.register_checkout_v2_price_snapshot(',
            'CREATE OR REPLACE FUNCTION public.initialize_checkout_v2_billing(',
            'p_initial_stripe_price_id TEXT',
            'CREATE OR REPLACE FUNCTION public.reconcile_checkout_v2_provisional_anchor(',
            'p_new_first_local_date DATE',
            "SET scheduled_at = 'infinity'::TIMESTAMPTZ",
            'checkout_v2_cycle_session_index - 1) * 7',
            'CREATE OR REPLACE FUNCTION public.fix_checkout_v2_billing_anchor(',
            'CREATE OR REPLACE FUNCTION public.apply_checkout_v2_renewal(',
            'checkout_v2_renewal_requires_cycle_ledger',
            'release_checkout_v2_allocation_on_subscription_end_trigger',
            'checkout_v2_terminal_subscription_cannot_reopen',
            'checkout_v2_billing_foundation_requires_zero_durable_v2_slots',
            'checkout_v2_billing_foundation_rejects_unbound_active_subscription',
            'unexpected_bookable_slot_validation_source',
            'checkout_v2_cycle_binding_is_immutable',
            "cycle_row.materialization_state = 'ready'",
            'checkout_v2_materialized_session_cannot_be_deleted',
            'pg_catalog.generate_series(0, 3)',
            'REVOKE INSERT, UPDATE, DELETE ON TABLE public.checkout_v2_cycles',
            'GRANT SELECT ON TABLE public.checkout_v2_cycles TO service_role',
        ]) {
            expect(checkoutV2BillingMigration).toContain(snippet);
            expect(schema).toContain(snippet);
        }

        expect(checkoutV2BillingMigration).not.toContain(
            'GRANT SELECT, INSERT, UPDATE ON TABLE public.checkout_v2_cycles',
        );
        expect(checkoutV2BillingMigration).not.toContain(
            'sessions_used SMALLINT NOT NULL',
        );

        for (const typeSnippet of [
            'checkout_v2_billing_state: {',
            'checkout_v2_cycles: {',
            'checkout_v2_price_snapshots: {',
            'checkout_v2_weekly_allocations: {',
            'checkout_v2_cycle_session_index: number | null;',
            'materialization_state: string;',
            'sessions_materialized_at: string | null;',
            'stripe_price_id: string;',
            'apply_checkout_v2_renewal: {',
            'fix_checkout_v2_billing_anchor: {',
            'initialize_checkout_v2_billing: {',
            'p_initial_stripe_price_id: string;',
            'reconcile_checkout_v2_provisional_anchor: {',
            'p_new_first_local_date: string;',
            'register_checkout_v2_price_snapshot: {',
        ]) {
            expect(databaseTypes).toContain(typeSnippet);
        }

        for (const functionName of [
            'private.guard_subscription_checkout_binding()',
            'private.guard_checkout_v2_billing_state()',
            'private.guard_checkout_v2_weekly_allocation()',
            'private.sync_checkout_v2_weekly_allocation()',
            'private.release_checkout_v2_allocation_on_subscription_end()',
            'private.guard_checkout_v2_session_position()',
            'private.guard_checkout_v2_materialized_session_delete()',
            'public.initialize_checkout_v2_billing(',
            'public.reconcile_checkout_v2_provisional_anchor(',
            'public.fix_checkout_v2_billing_anchor(',
            'public.apply_checkout_v2_renewal(',
            'public.apply_subscription_renewal(',
        ]) {
            expect(canonicalLatestSqlFunction(schema, functionName)).toBe(
                canonicalLatestSqlFunction(checkoutV2BillingMigration, functionName),
            );
        }

        for (const functionName of [
            'private.guard_checkout_v2_price_snapshot()',
            'public.register_checkout_v2_price_snapshot(',
        ]) {
            expect(canonicalLatestSqlFunction(schema, functionName)).toBe(
                canonicalLatestSqlFunction(catalogV2AdminMigration, functionName),
            );
        }

        for (const functionName of [
            'private.guard_checkout_v2_cycle()',
            'private.guard_checkout_v2_cycle_binding()',
            'public.materialize_checkout_v2_cycle_sessions(',
        ]) {
            expect(canonicalLatestSqlFunction(schema, functionName)).toBe(
                canonicalLatestSqlFunction(checkoutV2ReplacementLineageMigration, functionName),
            );
        }
    });

    it('limits live Checkout V2 holds by an opaque network fingerprint without legacy RPC bypasses', () => {
        for (const snippet of [
            'ADD COLUMN hold_fingerprint TEXT',
            'bookable_slot_holds_fingerprint_lifecycle_check',
            "hold_fingerprint ~ '^v1:[0-9a-f]{64}$'",
            'bookable_slot_holds_one_live_fingerprint_idx',
            "WHERE status = 'held'",
            'NEW.hold_fingerprint := NULL',
            'pg_catalog.hashtextextended(p_hold_fingerprint, 72941)',
            "RAISE EXCEPTION 'checkout_hold_fingerprint_already_active'",
            "stale_intent.status = 'creating'",
            'stale_intent.expires_at <= clock_timestamp()',
            'stale_intent.stripe_customer_id IS NULL',
            'stale_intent.stripe_checkout_session_id IS NULL',
            'DROP FUNCTION public.hold_bookable_slot(UUID, UUID)',
            'UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, UUID, TEXT',
            'UUID, TEXT, TEXT, UUID, TEXT, TEXT, TEXT, UUID, TEXT',
            'p_hold_fingerprint',
        ]) {
            expect(checkoutHoldProtectionMigration).toContain(snippet);
            expect(schema).toContain(snippet);
        }

        expect(checkoutHoldProtectionMigration).toContain(
            'DROP FUNCTION public.claim_checkout_intent_for_slot(\n    UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, UUID\n)',
        );
        expect(checkoutHoldProtectionMigration).toContain(
            'DROP FUNCTION public.claim_direct_checkout_intent_for_slot(\n    UUID, TEXT, TEXT, UUID, TEXT, TEXT, TEXT, UUID\n)',
        );
        expect(checkoutHoldProtectionMigration).toContain(
            'stale_hold.hold_fingerprint = p_hold_fingerprint',
        );
        expect(checkoutHoldProtectionMigration).not.toMatch(/\b(remote_?ip|client_?ip|ip_address)\b/i);

        const protectedHoldFunction = canonicalLatestSqlFunction(
            checkoutHoldProtectionMigration,
            'public.hold_bookable_slot(',
        );
        expect(protectedHoldFunction.indexOf('WHERE checkout_intent_id = p_checkout_intent_id')).toBeLessThan(
            protectedHoldFunction.indexOf("intent_row.status NOT IN ('creating', 'open')"),
        );
        expect(protectedHoldFunction).not.toContain(
            'hold_row.hold_fingerprint IS DISTINCT FROM p_hold_fingerprint',
        );

        for (const functionName of [
            'private.guard_bookable_slot_hold()',
            'public.hold_bookable_slot(',
            'public.claim_direct_checkout_intent_for_slot(',
        ]) {
            expect(canonicalLatestSqlFunction(schema, functionName)).toBe(
                canonicalLatestSqlFunction(checkoutHoldProtectionMigration, functionName),
            );
        }

        for (const functionName of [
            'private.guard_checkout_intent_snapshots()',
            'public.claim_checkout_intent_for_slot(',
        ]) {
            expect(canonicalLatestSqlFunction(schema, functionName)).toBe(
                canonicalLatestSqlFunction(checkoutPolicyRotationMigration, functionName),
            );
        }

        for (const snippet of [
            "current_setting(\n                   'app.checkout_policy_rotation_intent_id',",
            "close_reason = 'legal_policy_version_rotated'",
            "intent_row.status <> 'creating'",
            'intent_row.stripe_customer_id IS NOT NULL',
            "RAISE EXCEPTION 'checkout_policy_rotation_did_not_create_successor'",
            'REVOKE ALL ON FUNCTION public.claim_checkout_intent_for_slot(',
            ') TO service_role;',
        ]) {
            expect(checkoutPolicyRotationMigration).toContain(snippet);
            expect(schema).toContain(snippet);
        }

        for (const typeSnippet of [
            'hold_fingerprint: string | null;',
            'p_hold_fingerprint: string;',
        ]) {
            expect(databaseTypes).toContain(typeSnippet);
        }
    });

    it('commits one durable Calendar and Meet job with every ready Checkout V2 cycle', () => {
        for (const snippet of [
            'CREATE OR REPLACE FUNCTION private.ensure_checkout_v2_cycle_fulfillment(',
            'CREATE OR REPLACE FUNCTION private.enqueue_checkout_v2_cycle_fulfillment()',
            'CREATE OR REPLACE FUNCTION private.assert_checkout_v2_cycle_fulfillment_upgrade_safe()',
            'SECURITY DEFINER',
            'SECURITY INVOKER',
            "session_count IS DISTINCT FROM 4",
            'ARRAY[1, 2, 3, 4]::SMALLINT[]',
            "'checkout_v2_cycle:' || cycle_row.id::TEXT",
            "'checkoutV2CycleId', cycle_row.id",
            "'sessionIds', pg_catalog.to_jsonb(session_ids)",
            "'autoCreateMeeting', TRUE",
            "'sendEmail', TRUE",
            'ON CONFLICT (job_type, dedupe_key)',
            'job_row.payload IS DISTINCT FROM cycle_payload',
            "RAISE EXCEPTION 'checkout_v2_cycle_fulfillment_job_conflicts'",
            'CREATE CONSTRAINT TRIGGER enqueue_checkout_v2_cycle_fulfillment_trigger',
            'DEFERRABLE INITIALLY DEFERRED',
            "'checkout_v2_cycle_fulfillment_upgrade_requires_exact_ready_cycle_jobs'",
            'REVOKE ALL ON FUNCTION private.ensure_checkout_v2_cycle_fulfillment(UUID)',
            'REVOKE ALL ON FUNCTION private.assert_checkout_v2_cycle_fulfillment_upgrade_safe()',
            'SELECT private.assert_checkout_v2_cycle_fulfillment_upgrade_safe()',
            'FROM PUBLIC, anon, authenticated, service_role',
        ]) {
            expect(checkoutV2CycleFulfillmentMigration).toContain(snippet);
            expect(schema).toContain(snippet);
        }

        for (const functionName of [
            'private.ensure_checkout_v2_cycle_fulfillment(',
            'private.enqueue_checkout_v2_cycle_fulfillment()',
            'private.assert_checkout_v2_cycle_fulfillment_upgrade_safe()',
        ]) {
            expect(canonicalLatestSqlFunction(schema, functionName)).toBe(
                canonicalLatestSqlFunction(checkoutV2CycleFulfillmentMigration, functionName),
            );
        }
    });

    it('keeps Checkout V2 rescheduling durable, serialized and service-role only', () => {
        for (const snippet of [
            'CREATE TABLE public.checkout_v2_reschedule_operations (',
            'request_id UUID NOT NULL UNIQUE',
            "operation_kind IN ('provisional_anchor', 'single_session')",
            "status IN ('requested', 'applied', 'failed', 'manual_review')",
            'stripe_mutation_started_at TIMESTAMPTZ',
            'checkout_v2_reschedule_one_pending_subscription_idx',
            "WHERE status IN ('requested', 'manual_review')",
            "'session_reschedule'",
            'fulfillment_jobs_one_processing_subscription_idx',
            "WHERE subscription_id IS NOT NULL AND status = 'processing'",
            "'checkout_v2_reschedule_upgrade_requires_one_processing_job_per_subscription'",
            'CREATE OR REPLACE FUNCTION public.prepare_checkout_v2_reschedule(',
            'CREATE OR REPLACE FUNCTION public.begin_checkout_v2_reschedule_stripe_mutation(',
            'CREATE OR REPLACE FUNCTION public.mark_checkout_v2_reschedule_outcome(',
            'p_observed_stripe_anchor_at TIMESTAMPTZ DEFAULT NULL',
            "'stripe_confirmed_at_previous_anchor'",
            "observed_stripe_anchor_at IS NULL\n                    AND last_error <> 'stripe_confirmed_at_previous_anchor'",
            "last_error = 'stripe_confirmed_at_previous_anchor'\n                    AND observed_stripe_anchor_at IS NOT NULL",
            "operation_row.status = 'requested'\n            AND p_observed_stripe_anchor_at IS NULL\n            AND p_last_error <> 'stripe_confirmed_at_previous_anchor'",
            'CREATE OR REPLACE FUNCTION public.apply_checkout_v2_reschedule(',
            "last_error = 'expired_before_stripe_mutation'",
            "pending_operation.status IN ('requested', 'manual_review')",
            "operation_row.old_scheduled_at < operation_row.created_at + INTERVAL '24 hours'",
            'operation_row.stripe_mutation_started_at IS NULL',
            'CREATE OR REPLACE FUNCTION private.checkout_v2_reschedule_has_sufficient_notice(',
            "p_scheduled_at >= p_requested_at + INTERVAL '24 hours'",
            'CREATE OR REPLACE FUNCTION private.checkout_v2_reschedule_target_is_available(',
            'target_local::TIME - availability.start_time',
            'p_duration_minutes::BIGINT * 60',
            'allocation_row.subscription_id IS DISTINCT FROM p_subscription_id',
            'session_row.teacher_id IS DISTINCT FROM allocation_row.teacher_id',
            "RAISE EXCEPTION 'checkout_v2_reschedule_subscription_has_pending_operation'",
            'CREATE OR REPLACE FUNCTION public.cancel_scheduled_session(',
            'pg_catalog.hashtextextended(v_discovered_subscription_id::TEXT, 42854)',
            'CREATE OR REPLACE FUNCTION private.guard_session_against_bookable_slots()',
            'SECURITY DEFINER',
            'FROM PUBLIC, anon, authenticated, service_role',
            'operation.stripe_mutation_started_at IS NOT NULL',
            'CREATE OR REPLACE FUNCTION public.materialize_checkout_v2_cycle_sessions(',
            'pg_catalog.hashtextextended(p_subscription_id::TEXT, 42854)',
            "'session_cancellation:' || v_session.id::TEXT",
            "'sessionId', v_session.id",
            "'cancelledBy', p_cancelled_by_role",
            "'reason', p_cancellation_reason",
            "RAISE EXCEPTION 'session_cancellation_job_conflicts'",
            'CREATE OR REPLACE FUNCTION private.guard_checkout_v2_reschedule_locked_state()',
            "current_setting('app.checkout_v2_reschedule_operation_id', TRUE)",
            'operation.id::TEXT IS DISTINCT FROM bypass_operation_id',
            "RAISE EXCEPTION 'checkout_v2_reschedule_session_is_locked'",
            "USING ERRCODE = '40001'",
            'guard_checkout_v2_reschedule_subscription_state',
            'guard_checkout_v2_reschedule_billing_state',
            'guard_checkout_v2_reschedule_cycle_state',
            "'app.checkout_v2_reschedule_operation_id'",
            'CREATE OR REPLACE FUNCTION private.validate_checkout_v2_first_session_coherence()',
            'DEFERRABLE INITIALLY DEFERRED',
            'CREATE OR REPLACE FUNCTION private.assert_checkout_v2_first_session_coherence_upgrade_safe()',
            "'checkout_v2_reschedule_upgrade_requires_coherent_first_session_billing_cycle'",
            "'checkout_v2_reschedule:' || operation_row.id::TEXT",
            "'operationId', operation_row.id",
            "'previousScheduledAt', old_session_times -> moved_session.id::TEXT",
            "'scheduledAt', moved_session.scheduled_at",
            "'sendEmail', TRUE",
            'REVOKE INSERT, UPDATE, DELETE ON TABLE public.checkout_v2_reschedule_operations',
            'GRANT SELECT ON TABLE public.checkout_v2_reschedule_operations TO service_role',
            'GRANT EXECUTE ON FUNCTION public.prepare_checkout_v2_reschedule(',
            'GRANT EXECUTE ON FUNCTION public.begin_checkout_v2_reschedule_stripe_mutation(UUID)',
            'GRANT EXECUTE ON FUNCTION public.mark_checkout_v2_reschedule_outcome(',
            'GRANT EXECUTE ON FUNCTION public.apply_checkout_v2_reschedule(',
            'REVOKE EXECUTE ON FUNCTION public.reconcile_checkout_v2_provisional_anchor(',
            'SELECT private.assert_checkout_v2_first_session_coherence_upgrade_safe()',
        ]) {
            expect(checkoutV2RescheduleMigration).toContain(snippet);
            expect(schema).toContain(snippet);
        }

        for (const typeSnippet of [
            'checkout_v2_reschedule_operations: {',
            'expected_anchor_revision: number;',
            'target_stripe_anchor_at: string | null;',
            'observed_stripe_anchor_at: string | null;',
            'stripe_mutation_started_at: string | null;',
            'apply_checkout_v2_reschedule: {',
            'p_observed_stripe_anchor_at?: string | null;',
            'begin_checkout_v2_reschedule_stripe_mutation: {',
            'mark_checkout_v2_reschedule_outcome: {',
            'prepare_checkout_v2_reschedule: {',
            'p_new_scheduled_at: string;',
        ]) {
            expect(databaseTypes).toContain(typeSnippet);
        }

        expect(databaseTypes).toContain(
            'mark_checkout_v2_reschedule_outcome: {\n'
            + '        Args: {\n'
            + '          p_last_error: string;\n'
            + '          p_observed_stripe_anchor_at?: string | null;',
        );

        for (const functionName of [
            'public.cancel_scheduled_session(',
            'private.checkout_v2_reschedule_has_sufficient_notice(',
            'private.checkout_v2_reschedule_target_is_available(',
            'private.guard_checkout_v2_reschedule_locked_state()',
            'public.begin_checkout_v2_reschedule_stripe_mutation(',
            'public.mark_checkout_v2_reschedule_outcome(',
        ]) {
            expect(canonicalLatestSqlFunction(schema, functionName)).toBe(
                canonicalLatestSqlFunction(checkoutV2RescheduleMigration, functionName),
            );
        }

        for (const functionName of [
            'public.prepare_checkout_v2_reschedule(',
            'public.apply_checkout_v2_reschedule(',
            'private.validate_checkout_v2_first_session_coherence()',
            'private.assert_checkout_v2_first_session_coherence_upgrade_safe()',
        ]) {
            expect(canonicalLatestSqlFunction(schema, functionName)).toBe(
                canonicalLatestSqlFunction(checkoutV2ReplacementLineageMigration, functionName),
            );
        }

        expect(checkoutV2RescheduleMigration).not.toContain(
            'GRANT INSERT, UPDATE ON TABLE public.checkout_v2_reschedule_operations',
        );
        expect(checkoutV2RescheduleMigration).not.toContain(
            'GRANT EXECUTE ON FUNCTION public.reconcile_checkout_v2_provisional_anchor',
        );
    });

    it('lists Checkout V2 reschedule targets read-only from the durable policy boundary', () => {
        for (const snippet of [
            'CREATE OR REPLACE FUNCTION private.checkout_v2_reschedule_is_within_self_service_horizon(',
            'JOIN public.bookable_slots AS sold_slot',
            'sold_slot.id = allocation.slot_id',
            'sold_slot.sold_subscription_id = p_subscription_id',
            '(p_target_at AT TIME ZONE allocation.timezone_name)',
            '<= (sold_slot.first_occurrence_at AT TIME ZONE allocation.timezone_name)',
            "IF NEW.operation_kind = 'provisional_anchor'",
            "OR NEW.status IN ('requested', 'manual_review')",
            "NEW.status = 'applied'",
            "OLD.status IS DISTINCT FROM 'applied'",
            'CREATE OR REPLACE FUNCTION private.guard_checkout_v2_reschedule_self_service_horizon()',
            "RAISE EXCEPTION 'checkout_v2_reschedule_exceeds_self_service_horizon'",
            'CREATE TRIGGER guard_checkout_v2_reschedule_self_service_horizon_trigger',
            'BEFORE INSERT OR UPDATE ON public.checkout_v2_reschedule_operations',
            'CREATE OR REPLACE FUNCTION private.assert_checkout_v2_reschedule_self_service_horizon_upgrade_safe()',
            "operation.status IN ('requested', 'manual_review')",
            "operation.operation_kind = 'provisional_anchor'",
            "'checkout_v2_reschedule_upgrade_exceeds_self_service_horizon'",
            'SELECT private.assert_checkout_v2_reschedule_self_service_horizon_upgrade_safe()',
            'FROM PUBLIC, anon, authenticated, service_role',
            'CREATE OR REPLACE FUNCTION public.list_checkout_v2_reschedule_targets(',
            'p_ignored_pending_request_id UUID DEFAULT NULL',
            'RETURNS TABLE (\n    target_scheduled_at TIMESTAMPTZ,\n    operation_kind TEXT,\n    affected_scheduled_ats TIMESTAMPTZ[]',
            'LANGUAGE plpgsql\nSTABLE\nSECURITY DEFINER\nSET search_path = \'\'',
            "p_to - p_from > INTERVAL '48 hours'",
            "RAISE EXCEPTION 'checkout_v2_reschedule_forbidden'",
            "pending_operation.status = 'manual_review'",
            "pending_operation.status = 'requested'",
            'pending_operation.stripe_mutation_started_at IS NOT NULL',
            "> requested_at - INTERVAL '15 minutes'",
            'operation.request_id = p_ignored_pending_request_id',
            'ignored_operation.session_id IS DISTINCT FROM p_session_id',
            'ignored_operation.actor_id IS DISTINCT FROM p_actor_id',
            'ignored_operation.new_scheduled_at IS DISTINCT FROM p_from',
            "p_to IS DISTINCT FROM p_from + INTERVAL '1 second'",
            "ignored_operation.status IS DISTINCT FROM 'requested'",
            'ignored_operation.stripe_mutation_started_at IS NOT NULL',
            "RAISE EXCEPTION 'checkout_v2_reschedule_ignored_pending_request_is_invalid'",
            'pending_operation.request_id IS DISTINCT FROM',
            "billing_row.anchor_state = 'provisional'",
            'private.checkout_v2_reschedule_has_sufficient_notice(',
            'private.checkout_v2_reschedule_target_is_available(',
            'pg_catalog.generate_series(',
            'local_day.day_at + allocation_row.local_start_time AS local_at',
            'WHERE provisional_anchor',
            'WHERE NOT provisional_anchor',
            "operation_kind := 'provisional_anchor'",
            "operation_kind := 'single_session'",
            'candidate_at <= previous_scheduled_at',
            'candidate_at >= next_scheduled_at',
            'candidate_affected_ats := pg_catalog.array_append(',
            'CONTINUE WHEN provisional_anchor\n          AND NOT private.checkout_v2_reschedule_is_within_self_service_horizon(',
            'REVOKE ALL ON FUNCTION public.list_checkout_v2_reschedule_targets(',
            ') FROM PUBLIC, anon, authenticated;',
            ') TO service_role;',
        ]) {
            expect(checkoutV2RescheduleTargetsMigration).toContain(snippet);
            expect(schema).toContain(snippet);
        }

        expect(canonicalLatestSqlFunction(
            schema,
            'public.list_checkout_v2_reschedule_targets(',
        )).toBe(canonicalLatestSqlFunction(
            checkoutV2ReplacementLineageMigration,
            'public.list_checkout_v2_reschedule_targets(',
        ));

        for (const functionName of [
            'private.checkout_v2_reschedule_is_within_self_service_horizon(',
            'private.guard_checkout_v2_reschedule_self_service_horizon()',
            'private.assert_checkout_v2_reschedule_self_service_horizon_upgrade_safe()',
        ]) {
            expect(canonicalLatestSqlFunction(schema, functionName)).toBe(
                canonicalLatestSqlFunction(checkoutV2RescheduleTargetsMigration, functionName),
            );
        }

        for (const typeSnippet of [
            'list_checkout_v2_reschedule_targets: {',
            'p_actor_id: string;',
            'p_from: string;',
            'p_ignored_pending_request_id?: string | null;',
            'p_session_id: string;',
            'p_to: string;',
            'affected_scheduled_ats: string[];',
            'operation_kind: string;',
            'target_scheduled_at: string;',
        ]) {
            expect(databaseTypes).toContain(typeSnippet);
        }
    });

    it('serializes checkout claims and preserves unambiguous billing lifecycle state', () => {
        const canonicalClaimFunction = schema.slice(
            schema.indexOf('CREATE OR REPLACE FUNCTION public.claim_checkout_intent'),
            schema.indexOf('CREATE OR REPLACE FUNCTION public.complete_checkout_intent'),
        );
        const canonicalCompleteFunction = schema.slice(
            schema.indexOf('CREATE OR REPLACE FUNCTION public.complete_checkout_intent'),
            schema.indexOf('CREATE OR REPLACE FUNCTION public.release_expired_checkout_intent'),
        );

        for (const snippet of [
            'FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE RESTRICT',
            "status = 'creating'",
            'AND stripe_checkout_session_id IS NULL',
            "status = 'open'",
            'AND stripe_checkout_session_id IS NOT NULL',
            "status = 'completed'",
            'AND completed_at IS NOT NULL',
            "status = 'expired'",
            'PERFORM 1',
            'FROM public.profiles',
            "AND role = 'student'",
            'checkout_student_is_not_available',
            "intent_row.status = 'creating'",
            "intent_row.status = 'open'",
            'stripe_checkout_session_id = p_stripe_checkout_session_id',
            "COALESCE(bool_or(status = 'completed'), FALSE)",
            "NEW.stage = 'won'",
            'NEW.converted_subscription_id IS NOT NULL',
            'converted_subscription.package_price_id = completed_intent.package_price_id',
            'p_subscription_id IS NULL',
            'p_payment_id IS NULL',
            'p_package_id IS NULL',
            'p_intent_id IS NULL',
        ]) {
            expect(billingReconciliationMigration).toContain(snippet);
        }

        for (const signature of [
            'public.claim_checkout_intent(UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT)',
            'public.complete_checkout_intent(UUID, UUID, UUID, UUID, TEXT)',
            'public.release_expired_checkout_intent(UUID, TEXT)',
            'public.apply_subscription_renewal(UUID, TEXT, TEXT, DATE)',
            'public.reconcile_stripe_refund(UUID, INTEGER, TEXT, TIMESTAMPTZ)',
            'public.activate_package_price(\n    UUID, BIGINT, SMALLINT, INTEGER, TEXT, TEXT, BOOLEAN, TEXT, TEXT, UUID\n)',
        ]) {
            expect(billingReconciliationMigration).toContain(`GRANT EXECUTE ON FUNCTION ${signature}`);
        }

        expect(billingReconciliationMigration).not.toContain('AND expires_at <= claim_time');
        expect(billingReconciliationMigration.match(/SET search_path = ''/g)).toHaveLength(7);

        expect(schema).toContain('created_by UUID REFERENCES profiles(id) ON DELETE RESTRICT');
        expect(schema).not.toContain('created_by UUID REFERENCES profiles(id) ON DELETE SET NULL');
        expect(schema).toContain("status = 'creating'\n            AND stripe_checkout_session_id IS NULL");
        expect(schema).toContain("status = 'open'\n            AND stripe_checkout_session_id IS NOT NULL");
        expect(schema).toContain("status = 'completed'\n            AND stripe_checkout_session_id IS NOT NULL\n            AND completed_at IS NOT NULL");
        expect(schema).toContain("status = 'expired'\n            AND completed_at IS NULL");
        expect(canonicalClaimFunction).toContain('FROM public.profiles');
        expect(canonicalClaimFunction).toContain('FOR UPDATE');
        expect(canonicalClaimFunction).not.toContain('expires_at <= claim_time');
        expect(canonicalCompleteFunction).not.toContain('UPDATE public.crm_opportunities');
    });

    it('blocks unreconciled paid intents and gates orphan recovery on an exact Customer snapshot', () => {
        for (const snippet of [
            "checkout_intent.status = 'completed'",
            'intent_opportunity.converted_subscription_id IS NULL',
            "WHEN 'completed' THEN 0",
            'FOR UPDATE OF checkout_intent',
            'CREATE OR REPLACE FUNCTION public.snapshot_checkout_intent_customer',
            'CREATE OR REPLACE FUNCTION public.release_abandoned_checkout_intent',
            "intent_row.status <> 'creating'",
            'intent_row.stripe_checkout_session_id IS NOT NULL',
            'intent_row.stripe_customer_id IS DISTINCT FROM p_stripe_customer_id',
            'intent_row.expires_at > clock_timestamp()',
            'checkout_intent_cannot_be_abandoned',
            'GRANT EXECUTE ON FUNCTION public.snapshot_checkout_intent_customer(UUID, TEXT)',
            'GRANT EXECUTE ON FUNCTION public.release_abandoned_checkout_intent(UUID, TEXT)',
        ]) {
            expect(checkoutRecoveryMigration).toContain(snippet);
        }

        for (const snippet of [
            'CREATE OR REPLACE FUNCTION public.snapshot_checkout_intent_customer',
            'CREATE OR REPLACE FUNCTION public.release_abandoned_checkout_intent',
            'snapshot_checkout_intent_customer: {',
            'release_abandoned_checkout_intent: {',
        ]) {
            expect(`${schema}\n${databaseTypes}`).toContain(snippet);
        }

        const releaseFunction = checkoutRecoveryMigration.slice(
            checkoutRecoveryMigration.indexOf('CREATE OR REPLACE FUNCTION public.release_abandoned_checkout_intent'),
        );
        expect(releaseFunction).not.toContain("status = 'completed'");
        expect(releaseFunction).not.toContain('stripe_checkout_session_id = p_stripe_checkout_session_id');
    });

    it('freezes checkout evidence and requires the exact Stripe Customer at completion', () => {
        for (const snippet of [
            'CREATE OR REPLACE FUNCTION private.guard_checkout_intent_snapshots()',
            'checkout_intent_snapshot_is_immutable',
            'checkout_intent_customer_is_immutable',
            'checkout_intent_session_is_immutable',
            'checkout_intent_transition_is_not_allowed',
            "OLD.status = 'creating'",
            "NEW.status = 'open'",
            "NEW.status = 'completed'",
            "NEW.status = 'expired'",
            "OLD.status = 'open'",
            'CREATE TRIGGER guard_checkout_intent_snapshots_trigger',
            'DROP FUNCTION public.complete_checkout_intent(UUID, UUID, UUID, UUID, TEXT)',
            'p_stripe_customer_id TEXT',
            'intent_row.stripe_customer_id IS DISTINCT FROM p_stripe_customer_id',
            'GRANT EXECUTE ON FUNCTION public.complete_checkout_intent(UUID, UUID, UUID, UUID, TEXT, TEXT)',
        ]) {
            expect(checkoutSnapshotMigration).toContain(snippet);
        }

        for (const immutableColumn of [
            'NEW.opportunity_id',
            'NEW.contact_id',
            'NEW.student_id',
            'NEW.package_price_id',
            'NEW.lang',
            'NEW.legal_policy_version',
            'NEW.policy_accepted_at',
            'NEW.site_url',
            'NEW.stripe_session_expires_at',
            'NEW.expires_at',
            'NEW.created_at',
        ]) {
            expect(checkoutSnapshotMigration).toContain(immutableColumn);
        }

        expect(schema).toContain('CREATE OR REPLACE FUNCTION private.guard_checkout_intent_snapshots()');
        expect(schema).toContain('CREATE TRIGGER guard_checkout_intent_snapshots_trigger');
        expect(schema).toContain('public.complete_checkout_intent(UUID, UUID, UUID, UUID, TEXT, TEXT)');
        expect(databaseTypes).toContain('p_stripe_customer_id: string');
        expect(stripeWebhookRoute).toContain('subscriptionCustomerId !== sessionCustomerId');
        expect(stripeWebhookRoute).toContain('p_stripe_customer_id: sessionCustomerId');
        expect(stripeWebhookRoute).toContain('completedIntent.stripe_customer_id !== sessionCustomerId');
    });

    it('enforces student and teacher profile roles at the database boundary', () => {
        expect(schema).toContain('CREATE OR REPLACE FUNCTION private.enforce_profile_role_links()');
        expect(schema).toContain('SECURITY DEFINER');
        expect(schema).toContain('SET search_path = public, private, pg_temp');
        expect(schema).toContain("RAISE EXCEPTION 'studentId must belong to a student profile'");
        expect(schema).toContain("RAISE EXCEPTION 'teacherId must belong to a teacher profile'");
        expect(schema).toContain('REVOKE ALL ON FUNCTION private.enforce_profile_role_links() FROM authenticated');

        for (const triggerName of [
            'enforce_student_teacher_profile_roles',
            'enforce_session_profile_roles',
            'enforce_subscription_student_role',
            'enforce_payment_student_role',
            'enforce_fulfillment_job_student_role',
            'enforce_teacher_availability_teacher_role',
        ]) {
            expect(schema).toContain(`CREATE TRIGGER ${triggerName}`);
        }
    });

    it('defines the CRM core as admin-managed relationship data', () => {
        const compactSchema = schema.replace(/\s+/gu, ' ');
        for (const tableName of [
            'crm_contacts',
            'crm_opportunities',
            'crm_tasks',
            'crm_activities',
            'crm_consents',
        ]) {
            expect(schema).toContain(`CREATE TABLE ${tableName}`);
            expect(schema).toContain(`ALTER TABLE ${tableName} ENABLE ROW LEVEL SECURITY`);
        }

        expect(schema).toContain("lifecycle_stage TEXT NOT NULL DEFAULT 'lead'");
        expect(schema).toContain("stage TEXT NOT NULL DEFAULT 'new'");
        expect(schema).toContain("task_type TEXT NOT NULL DEFAULT 'review'");
        expect(schema).toContain('related_entity_type TEXT');
        expect(schema).toContain('related_entity_id TEXT');
        expect(schema).toContain("metadata JSONB NOT NULL DEFAULT '{}'::jsonb");
        expect(schema).toContain("activity_type TEXT NOT NULL CHECK");
        expect(schema).toContain("legal_basis TEXT NOT NULL CHECK");
        expect(schema).toContain('CREATE POLICY "Admins can manage crm contacts"');
        expect(schema).toContain('CREATE POLICY "Admins can manage crm opportunities"');
        expect(schema).toContain('CREATE POLICY "Admins can manage crm tasks"');
        expect(schema).toContain('CREATE POLICY "Admins can manage crm activities"');
        expect(schema).toContain('CREATE POLICY "Admins can manage crm consents"');
        expect(schema).toContain('REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon, authenticated');
        expect(compactSchema).toContain(
            'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE leads, crm_contacts, crm_opportunities, crm_tasks, crm_activities, crm_consents, fulfillment_jobs, packages, payments, profiles, profiles_private, sessions, student_teachers, subscriptions, teacher_availability TO authenticated',
        );
        expect(compactSchema).toContain(
            'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE leads, crm_contacts, crm_opportunities, crm_tasks, crm_activities, crm_consents TO service_role',
        );
    });

    it('keeps the hosted CRM migration retry-safe for staging rollout', () => {
        for (const tableName of [
            'crm_contacts',
            'crm_opportunities',
            'crm_tasks',
            'crm_activities',
            'crm_consents',
        ]) {
            expect(crmMigration).toContain(`CREATE TABLE IF NOT EXISTS public.${tableName}`);
            expect(crmMigration).toContain(`ALTER TABLE public.${tableName} ENABLE ROW LEVEL SECURITY`);
        }

        for (const policyName of [
            'Admins can manage crm contacts',
            'Admins can manage crm opportunities',
            'Admins can manage crm tasks',
            'Admins can manage crm activities',
            'Admins can manage crm consents',
        ]) {
            expect(crmMigration).toContain(`DROP POLICY IF EXISTS "${policyName}"`);
            expect(crmMigration).toContain(`CREATE POLICY "${policyName}"`);
        }

        expect(crmMigration).toContain('REVOKE ALL ON TABLE');
        expect(crmMigration).toContain('FROM anon');
        expect(crmMigration).toContain('FROM public');
        expect(crmMigration).toContain('TO authenticated');
        expect(crmMigration).toContain('TO service_role');
        expect(crmMigration).toContain('ON CONFLICT ((lower(primary_email))) DO UPDATE SET');
        expect(crmMigration).toContain('ON CONFLICT (legacy_lead_id) DO UPDATE SET');
        expect(crmMigration).toContain('ON CONFLICT (contact_id, channel, purpose) WHERE opted_out_at IS NULL DO UPDATE SET');
        expect(crmMigration).toContain("existing.related_entity_type = 'lead'");
        expect(crmMigration).toContain("existing.related_entity_type = 'profile'");
    });

    it('connects legacy leads to CRM contacts and opportunities without replacing the current leads table', () => {
        expect(schema).toContain('ADD COLUMN crm_contact_id UUID REFERENCES crm_contacts(id) ON DELETE SET NULL');
        expect(schema).toContain('ADD COLUMN crm_opportunity_id UUID REFERENCES crm_opportunities(id) ON DELETE SET NULL');
        expect(schema).toContain('legacy_lead_id UUID UNIQUE REFERENCES leads(id) ON DELETE SET NULL');
        expect(schema).toContain('CREATE INDEX leads_crm_contact_idx');
        expect(schema).toContain('CREATE INDEX leads_crm_opportunity_idx');
    });

    it('keeps lightweight level checks on leads with explicit retention fields', () => {
        expect(schema).toContain("level_check_status TEXT NOT NULL DEFAULT 'not_requested'");
        expect(schema).toContain("CHECK (level_check_status IN ('not_requested', 'recommended', 'sent', 'received', 'reviewed', 'waived'))");
        expect(schema).toContain("level_check_context JSONB NOT NULL DEFAULT '{}'::JSONB");
        expect(schema).toContain('level_check_summary TEXT');
        expect(schema).toContain('level_check_estimated_level TEXT');
        expect(schema).toContain("level_check_confidence TEXT CHECK (level_check_confidence IS NULL OR level_check_confidence IN ('low', 'medium', 'high'))");
        expect(schema).toContain('level_check_plan_recommendation TEXT');
        expect(schema).toContain("level_check_fit_flags TEXT[] NOT NULL DEFAULT '{}'::TEXT[]");
        expect(schema).toContain('level_check_raw_cleared_at TIMESTAMPTZ');
        expect(schema).toContain('CREATE INDEX leads_level_check_status_idx');
        expect(schema).toContain('CREATE INDEX leads_level_check_fit_flags_idx');
    });

    it('keeps lead language fields in the canonical schema for Russian-first intake', () => {
        expect(schema).toContain("spoken_languages TEXT[] NOT NULL DEFAULT '{}'::TEXT[]");
        expect(schema).toContain('is_russian_speaker BOOLEAN NOT NULL DEFAULT FALSE');
        expect(schema).toContain('CREATE INDEX leads_spoken_languages_idx');
        expect(schema).toContain('CREATE INDEX leads_is_russian_speaker_idx');
    });

    it('keeps staging rollout lead migrations idempotent and aligned with the app fields', () => {
        for (const snippet of [
            'ADD COLUMN IF NOT EXISTS current_level TEXT',
            'ADD COLUMN IF NOT EXISTS learning_goal TEXT',
            'ADD COLUMN IF NOT EXISTS availability TEXT',
            'ADD COLUMN IF NOT EXISTS source_path TEXT',
        ]) {
            expect(leadEnrichmentMigration).toContain(snippet);
        }

        expect(preferredPackageMigration).toContain('ADD COLUMN IF NOT EXISTS preferred_package TEXT');

        for (const snippet of [
            "ADD COLUMN IF NOT EXISTS spoken_languages TEXT[] NOT NULL DEFAULT '{}'::TEXT[]",
            'ADD COLUMN IF NOT EXISTS is_russian_speaker BOOLEAN NOT NULL DEFAULT FALSE',
            'CREATE INDEX IF NOT EXISTS leads_spoken_languages_idx',
            'CREATE INDEX IF NOT EXISTS leads_is_russian_speaker_idx',
        ]) {
            expect(leadLanguagesMigration).toContain(snippet);
        }

        for (const snippet of [
            "ADD COLUMN IF NOT EXISTS level_check_status TEXT NOT NULL DEFAULT 'not_requested'",
            "ADD COLUMN IF NOT EXISTS level_check_context JSONB NOT NULL DEFAULT '{}'::JSONB",
            'ADD COLUMN IF NOT EXISTS level_check_summary TEXT',
            'ADD COLUMN IF NOT EXISTS level_check_estimated_level TEXT',
            'ADD COLUMN IF NOT EXISTS level_check_confidence TEXT',
            'ADD COLUMN IF NOT EXISTS level_check_plan_recommendation TEXT',
            "ADD COLUMN IF NOT EXISTS level_check_fit_flags TEXT[] NOT NULL DEFAULT '{}'::TEXT[]",
            'ADD COLUMN IF NOT EXISTS level_check_raw_cleared_at TIMESTAMPTZ',
            'WHEN duplicate_object THEN NULL',
            'CREATE INDEX IF NOT EXISTS leads_level_check_status_idx',
            'CREATE INDEX IF NOT EXISTS leads_level_check_fit_flags_idx',
        ]) {
            expect(levelCheckMigration).toContain(snippet);
        }
    });

    it('keeps generated database types aligned with lead intake and diagnostic fields', () => {
        for (const snippet of [
            'current_level: string | null',
            'learning_goal: string | null',
            'availability: string | null',
            'source_path: string | null',
            'preferred_package: string | null',
            'spoken_languages: string[]',
            'is_russian_speaker: boolean',
            'level_check_status: string',
            'level_check_context: Json',
            'level_check_summary: string | null',
            'level_check_estimated_level: string | null',
            'level_check_confidence: string | null',
            'level_check_plan_recommendation: string | null',
            'level_check_fit_flags: string[]',
            'level_check_raw_cleared_at: string | null',
        ]) {
            expect(databaseTypes).toContain(snippet);
        }
    });

    it('indexes CRM joins, work queues and timelines', () => {
        for (const indexName of [
            'crm_contacts_primary_email_lower_unique',
            'crm_contacts_profile_id_unique',
            'crm_contacts_lifecycle_followup_idx',
            'crm_opportunities_contact_idx',
            'crm_opportunities_open_stage_idx',
            'crm_opportunities_preferred_package_idx',
            'crm_tasks_assigned_status_due_idx',
            'crm_tasks_open_due_idx',
            'crm_tasks_related_entity_idx',
            'crm_activities_contact_occurred_idx',
            'crm_activities_related_entity_idx',
            'crm_consents_one_active_per_contact_channel_purpose',
        ]) {
            expect(schema).toContain(indexName);
        }
    });

    it('keeps CRM activity separate from system audit logging', () => {
        expect(schema).toContain('CREATE TABLE crm_activities');
        expect(schema).toContain('CREATE TABLE admin_audit_log');
        expect(schema).toContain("activity_type TEXT NOT NULL CHECK (activity_type IN ('note', 'email_in', 'email_out', 'call', 'whatsapp', 'meeting', 'support', 'payment', 'class', 'system'))");
        expect(schema).toContain('related_entity_type TEXT');
        expect(schema).toContain('related_entity_id TEXT');
    });
});
