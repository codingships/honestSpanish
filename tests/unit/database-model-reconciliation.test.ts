import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const reconciliation = readFileSync(
    'supabase/migrations/20260712112000_reconcile_database_model_contract.sql',
    'utf8',
).replace(/\r\n/g, '\n');
const availabilityHardening = readFileSync(
    'supabase/migrations/20260712114000_harden_teacher_availability_overlap.sql',
    'utf8',
).replace(/\r\n/g, '\n');
const schema = readFileSync('db/schema.sql', 'utf8').replace(/\r\n/g, '\n');
const databaseTypes = readFileSync('src/types/database.types.ts', 'utf8').replace(/\r\n/g, '\n');

describe('database model reconciliation', () => {
    it('keeps the canonical schema free of patch artifacts', () => {
        expect(schema).not.toMatch(/^(?:\+|<<<<<<<.*|=======|>>>>>>>.*)$/mu);
    });

    it('normalizes the leads contract only after validating status values', () => {
        for (const snippet of [
            'ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()',
            "status::TEXT NOT IN ('new', 'contacted', 'discarded')",
            'DROP CONSTRAINT IF EXISTS leads_status_check',
            'ALTER COLUMN status TYPE public.lead_status',
            'USING status::TEXT::public.lead_status',
            "ALTER COLUMN lang SET DEFAULT 'es'::TEXT",
            'ALTER COLUMN consent_given SET DEFAULT FALSE',
            "ALTER COLUMN status SET DEFAULT 'new'::public.lead_status",
            'ALTER COLUMN status SET NOT NULL',
            "ALTER COLUMN created_at SET DEFAULT timezone('utc'::TEXT, NOW())",
            'ALTER COLUMN created_at SET NOT NULL',
        ]) {
            expect(reconciliation).toContain(snippet);
        }

        expect(reconciliation.indexOf('status::TEXT NOT IN')).toBeLessThan(
            reconciliation.indexOf('DROP CONSTRAINT IF EXISTS leads_status_check'),
        );
        expect(reconciliation.indexOf('DROP CONSTRAINT IF EXISTS leads_status_check')).toBeLessThan(
            reconciliation.indexOf('ALTER COLUMN status TYPE public.lead_status'),
        );
    });

    it('restores the canonical leads privileges and removes only the obsolete public helper', () => {
        for (const snippet of [
            'REVOKE ALL ON TABLE public.leads FROM PUBLIC, anon',
            'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.leads TO authenticated',
            'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.leads TO service_role',
            'DROP FUNCTION IF EXISTS public.is_admin()',
        ]) {
            expect(reconciliation).toContain(snippet);
        }

        expect(reconciliation).not.toMatch(/DROP FUNCTION IF EXISTS public[.]is_admin\(\).*CASCADE/);
        expect(schema).toContain('CREATE OR REPLACE FUNCTION private.is_admin()');
        expect(schema).not.toContain('CREATE OR REPLACE FUNCTION public.is_admin()');
    });

    it('backfills and removes all legacy session integration columns', () => {
        const legacyColumns = [
            ['drive_doc_link', 'drive_doc_url'],
            ['google_calendar_event_id', 'calendar_event_id'],
            ['google_meet_link', 'meet_link'],
        ] as const;

        for (const [legacy, canonical] of legacyColumns) {
            expect(reconciliation).toContain(`SET ${canonical} = COALESCE(${canonical}, ${legacy})`);
            expect(reconciliation).toContain(`DROP COLUMN IF EXISTS ${legacy}`);
            expect(schema).not.toContain(legacy);
        }
    });

    it('absorbs hosted-only reminder and profile-read objects into deployable history', () => {
        for (const snippet of [
            'ADD COLUMN IF NOT EXISTS reminder_sent BOOLEAN DEFAULT FALSE',
            'SET reminder_sent = FALSE',
            'ALTER COLUMN reminder_sent SET NOT NULL',
            'CREATE INDEX IF NOT EXISTS idx_sessions_reminder_pending',
            'CREATE INDEX IF NOT EXISTS idx_profiles_role',
            'DROP POLICY IF EXISTS "Students can view their teachers"',
            'CREATE POLICY "Students can view their teachers"',
            'TO authenticated',
            'assignment.student_id = (SELECT auth.uid())',
        ]) {
            expect(reconciliation).toContain(snippet);
        }

        expect(schema).toContain('reminder_sent BOOLEAN NOT NULL DEFAULT FALSE');
        expect(schema).toContain('CREATE INDEX idx_sessions_reminder_pending');
        expect(schema).toContain('CREATE INDEX idx_profiles_role');
        expect(databaseTypes).toContain('reminder_sent: boolean;');
        expect(databaseTypes).not.toContain('reminder_sent: boolean | null;');
    });

    it('covers the ten previously unindexed core foreign keys', () => {
        const coreIndexes = [
            'checkout_intents_contact_idx',
            'idx_fulfillment_jobs_student',
            'idx_fulfillment_jobs_subscription',
            'package_prices_created_by_idx',
            'payments_subscription_idx',
            'sessions_cancelled_by_idx',
            'sessions_subscription_idx',
            'student_teachers_teacher_idx',
            'subscriptions_package_idx',
            'idx_teacher_availability_teacher',
        ];

        expect(coreIndexes).toHaveLength(10);
        for (const indexName of coreIndexes) {
            expect(availabilityHardening).toContain(`INDEX IF NOT EXISTS ${indexName}`);
            expect(schema).toContain(`INDEX ${indexName}`);
        }
    });

    it('restores operational indexes and the availability updated_at trigger', () => {
        for (const indexName of [
            'idx_teacher_availability_day',
            'idx_sessions_status',
            'payments_stripe_payment_intent_idx',
        ]) {
            expect(availabilityHardening).toContain(`INDEX IF NOT EXISTS ${indexName}`);
            expect(schema).toContain(`INDEX ${indexName}`);
        }

        for (const sql of [availabilityHardening, schema]) {
            expect(sql).toContain('CREATE TRIGGER update_teacher_availability_updated_at');
            expect(sql).toContain('BEFORE UPDATE ON');
            expect(sql).toContain('EXECUTE FUNCTION public.update_updated_at()');
        }
    });

    it('enforces the application class-duration contract at the database boundary', () => {
        for (const snippet of [
            'duration_minutes IS NULL',
            'duration_minutes NOT IN (30, 40, 50)',
            'ALTER COLUMN duration_minutes SET NOT NULL',
            'CONSTRAINT sessions_duration_minutes_supported',
            'CHECK (duration_minutes IN (30, 40, 50))',
        ]) {
            expect(availabilityHardening).toContain(snippet);
            if (snippet.startsWith('CONSTRAINT') || snippet.startsWith('CHECK')) {
                expect(schema).toContain(snippet);
            }
        }

        expect(schema).toContain('duration_minutes INTEGER NOT NULL DEFAULT 50');
        expect(databaseTypes).toContain('duration_minutes: number;');
        expect(databaseTypes).not.toContain('duration_minutes: number | null;');
    });

    it('adds all six staging-smoke FK indexes only when the staging table exists', () => {
        const smokeIndexes = [
            'staging_integration_smoke_runs_student_idx',
            'staging_integration_smoke_runs_teacher_idx',
            'staging_integration_smoke_runs_subscription_idx',
            'staging_integration_smoke_runs_session_idx',
            'staging_integration_smoke_runs_fulfillment_job_idx',
            'staging_integration_smoke_runs_cancellation_job_idx',
        ];

        expect(smokeIndexes).toHaveLength(6);
        expect(availabilityHardening).toContain(
            "IF to_regclass('public.staging_integration_smoke_runs') IS NOT NULL THEN",
        );
        for (const indexName of smokeIndexes) {
            expect(availabilityHardening).toContain(`INDEX IF NOT EXISTS ${indexName}`);
            expect(schema).toContain(`INDEX ${indexName}`);
        }
    });

    it('requires a fresh generated-types snapshot after hosted application', () => {
        expect(reconciliation).toContain(
            'regenerate src/types/database.types.ts\n-- from the reconciled Supabase staging schema',
        );
    });

    it('keeps the generated staging types structurally aligned with the reconciled model', () => {
        const leadsBlock = databaseTypes.slice(
            databaseTypes.indexOf('      leads: {'),
            databaseTypes.indexOf('      package_prices: {'),
        );
        const profilesBlock = databaseTypes.slice(
            databaseTypes.indexOf('      profiles: {'),
            databaseTypes.indexOf('      profiles_private: {'),
        );

        expect(leadsBlock).toContain('foreignKeyName: "leads_crm_contact_id_fkey"');
        expect(leadsBlock).toContain('foreignKeyName: "leads_crm_opportunity_id_fkey"');
        expect(profilesBlock).not.toContain('leads_crm_contact_id_fkey');
        expect(profilesBlock).not.toContain('leads_crm_opportunity_id_fkey');
        expect(databaseTypes).toContain('session_tstzrange: {');
        expect(databaseTypes).not.toContain('      is_admin: { Args: never; Returns: boolean }');
        expect(databaseTypes).toContain('email_idempotency_key: string | null');
        expect(databaseTypes).toContain('email_idempotency_key?: string | null');
        expect(leadsBlock).toContain('created_at: string;');
        expect(leadsBlock).toContain('status: Database["public"]["Enums"]["lead_status"];');
        expect(leadsBlock).not.toContain('status: Database["public"]["Enums"]["lead_status"] | null;');
    });

    it('documents the deliberate nullable RPC overrides that Supabase cannot infer', () => {
        expect(databaseTypes).toContain('nullable RPC fields below are deliberately widened');
        for (const snippet of [
            'p_cancellation_reason?: string | null',
            'p_error?: Json | null',
            'p_provider_id?: string | null',
            'p_error_code: string | null',
            'p_http_status: number | null',
        ]) {
            expect(databaseTypes).toContain(snippet);
        }
    });
});
