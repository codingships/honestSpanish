import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (file: string) => readFileSync(file, 'utf8');

describe('CRM privacy operations', () => {
    it('keeps CRM schema and actions aligned with privacy constraints', () => {
        const schema = read('db/schema.sql');
        const actions = read('src/pages/api/admin/crm/contact-actions.ts');

        for (const tableName of [
            'crm_contacts',
            'crm_opportunities',
            'crm_tasks',
            'crm_activities',
            'crm_consents',
            'admin_audit_log',
        ]) {
            expect(schema).toContain(`ALTER TABLE ${tableName} ENABLE ROW LEVEL SECURITY`);
        }

        for (const policyName of [
            'Admins can manage crm contacts',
            'Admins can manage crm opportunities',
            'Admins can manage crm tasks',
            'Admins can manage crm activities',
            'Admins can manage crm consents',
        ]) {
            expect(schema).toContain(policyName);
        }

        expect(schema).toContain('crm_consents_one_active_per_contact_channel_purpose');
        expect(schema).toContain('opted_out_at TIMESTAMPTZ');
        expect(schema).toContain('manual_review_required');
        expect(actions).toContain('Contact is opted out for this channel and purpose');
        expect(actions).toContain('Manual review required before outbound communication');
        expect(actions).toContain('consent_override_reason');
        expect(actions).toContain("action: 'crm_activity.communication.create'");
    });
});
