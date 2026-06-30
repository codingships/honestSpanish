import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const schema = readFileSync('db/schema.sql', 'utf8').replace(/\r\n/g, '\n');
const leadEnrichmentMigration = readFileSync('supabase/migrations/018_enrich_leads_for_application.sql', 'utf8').replace(/\r\n/g, '\n');
const preferredPackageMigration = readFileSync('supabase/migrations/019_capture_preferred_package_on_leads.sql', 'utf8').replace(/\r\n/g, '\n');
const crmMigration = readFileSync('supabase/migrations/20260624163423_add_crm_core.sql', 'utf8').replace(/\r\n/g, '\n');
const leadLanguagesMigration = readFileSync('supabase/migrations/20260625213116_capture_lead_languages.sql', 'utf8').replace(/\r\n/g, '\n');
const levelCheckMigration = readFileSync('supabase/migrations/20260625215008_add_lightweight_level_check_to_leads.sql', 'utf8').replace(/\r\n/g, '\n');
const databaseTypes = readFileSync('src/types/database.types.ts', 'utf8').replace(/\r\n/g, '\n');

describe('database schema security invariants', () => {
    it('protects profile role and email from direct authenticated profile updates', () => {
        expect(schema).toContain('CREATE OR REPLACE FUNCTION protect_profile_role()');
        expect(schema).toContain('CREATE TRIGGER protect_profile_role_trigger');
        expect(schema).toContain('NEW.role IS DISTINCT FROM OLD.role');
        expect(schema).toContain('NEW.email IS DISTINCT FROM OLD.email');
        expect(schema).toContain('Cannot modify role');
        expect(schema).toContain('Cannot modify profile email');
    });

    it('keeps get_available_slots in the canonical schema and callable only by service_role', () => {
        expect(schema).toContain('CREATE OR REPLACE FUNCTION get_available_slots');
        expect(schema).toContain('SECURITY DEFINER');
        expect(schema).toContain('SET search_path = public');
        expect(schema).toContain('REVOKE EXECUTE ON FUNCTION get_available_slots(UUID, DATE, INTEGER) FROM anon');
        expect(schema).toContain('REVOKE EXECUTE ON FUNCTION get_available_slots(UUID, DATE, INTEGER) FROM authenticated');
        expect(schema).toContain('GRANT EXECUTE ON FUNCTION get_available_slots(UUID, DATE, INTEGER) TO service_role');
    });

    it('does not grant teachers a FOR ALL sessions policy that includes delete', () => {
        expect(schema).not.toContain('ON sessions FOR ALL \n    USING (teacher_id = auth.uid())');
        expect(schema).toContain('CREATE POLICY "Teachers can view assigned sessions"');
        expect(schema).toContain('ON sessions FOR SELECT');
        expect(schema).toContain('CREATE POLICY "Teachers can create assigned sessions"');
        expect(schema).toContain('ON sessions FOR INSERT');
        expect(schema).toContain('CREATE POLICY "Teachers can update assigned sessions"');
        expect(schema).toContain('ON sessions FOR UPDATE');
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
        expect(schema).toContain('REVOKE ALL ON TABLE leads, crm_contacts, crm_opportunities, crm_tasks, crm_activities, crm_consents FROM anon');
        expect(schema).toContain('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE leads, crm_contacts, crm_opportunities, crm_tasks, crm_activities, crm_consents TO authenticated');
        expect(schema).toContain('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE leads, crm_contacts, crm_opportunities, crm_tasks, crm_activities, crm_consents TO service_role');
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
