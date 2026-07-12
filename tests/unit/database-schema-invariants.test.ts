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
const stripeWebhookRoute = readFileSync('src/pages/api/stripe-webhook.ts', 'utf8').replace(/\r\n/g, '\n');
const profileRoleTriggerMigration = readFileSync('supabase/migrations/20260702124757_harden_profile_role_trigger.sql', 'utf8').replace(/\r\n/g, '\n');
const databaseTypes = readFileSync('src/types/database.types.ts', 'utf8').replace(/\r\n/g, '\n');

describe('database schema security invariants', () => {
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
