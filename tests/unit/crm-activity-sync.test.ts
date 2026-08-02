import { describe, expect, it, vi } from 'vitest';
import { recordCrmActivityForProfile } from '../../src/lib/crm/activity-sync';

function createQuery(result: { data: unknown; error: unknown }) {
    const chain: any = {
        select: vi.fn().mockReturnThis(),
        insert: vi.fn().mockReturnThis(),
        upsert: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue(result),
        single: vi.fn().mockResolvedValue(result),
    };
    return chain;
}

describe('recordCrmActivityForProfile', () => {
    it('records a CRM activity for an existing contact', async () => {
        const contactQuery = createQuery({ data: { id: 'contact-1' }, error: null });
        const duplicateQuery = createQuery({ data: null, error: null });
        const insertActivityQuery = createQuery({ data: { id: 'activity-1' }, error: null });
        const activityQueries = [duplicateQuery, insertActivityQuery];
        const client = {
            from: vi.fn((table: string) => {
                if (table === 'crm_contacts') return contactQuery;
                if (table === 'crm_activities') return activityQueries.shift();
                throw new Error(`Unexpected table ${table}`);
            }),
        };

        const result = await recordCrmActivityForProfile(client as any, {
            profileId: 'profile-1',
            email: 'Student@Example.com',
            fullName: 'Student One',
            activityType: 'payment',
            subject: 'Pago recibido',
            relatedEntityType: 'payment',
            relatedEntityId: 'payment-1',
            metadata: { amount: 12000 },
        });

        expect(result).toEqual({ status: 'created', activityId: 'activity-1' });
        expect(contactQuery.eq).toHaveBeenCalledWith('profile_id', 'profile-1');
        expect(insertActivityQuery.insert).toHaveBeenCalledWith(expect.objectContaining({
            contact_id: 'contact-1',
            activity_type: 'payment',
            subject: 'Pago recibido',
            related_entity_type: 'payment',
            related_entity_id: 'payment-1',
            metadata: { amount: 12000 },
        }));
    });

    it('skips duplicate related activities', async () => {
        const contactQuery = createQuery({ data: { id: 'contact-1' }, error: null });
        const duplicateQuery = createQuery({ data: { id: 'activity-existing' }, error: null });
        const client = {
            from: vi.fn((table: string) => {
                if (table === 'crm_contacts') return contactQuery;
                if (table === 'crm_activities') return duplicateQuery;
                throw new Error(`Unexpected table ${table}`);
            }),
        };

        const result = await recordCrmActivityForProfile(client as any, {
            profileId: 'profile-1',
            email: 'student@example.com',
            fullName: 'Student One',
            activityType: 'class',
            subject: 'Clase programada',
            relatedEntityType: 'session_scheduled',
            relatedEntityId: 'session-1',
        });

        expect(result.status).toBe('duplicate');
        expect(duplicateQuery.insert).not.toHaveBeenCalled();
    });

    it('converges an activity by a durable idempotency key', async () => {
        const contactQuery = createQuery({ data: { id: 'contact-1' }, error: null });
        const upsertQuery = createQuery({ data: null, error: null });
        const lookupQuery = createQuery({ data: { id: 'activity-1' }, error: null });
        const activityQueries = [upsertQuery, lookupQuery];
        const client = {
            from: vi.fn((table: string) => {
                if (table === 'crm_contacts') return contactQuery;
                if (table === 'crm_activities') return activityQueries.shift();
                throw new Error(`Unexpected table ${table}`);
            }),
        };

        const result = await recordCrmActivityForProfile(client as any, {
            profileId: 'profile-1',
            email: 'student@example.com',
            fullName: 'Student One',
            activityType: 'class',
            subject: 'Clase completada',
            relatedEntityType: 'session_completed',
            relatedEntityId: 'session-1',
            idempotencyKey: 'crm:session-outcome:activity:complete:session-1',
        });

        expect(result).toEqual({ status: 'created', activityId: 'activity-1' });
        expect(upsertQuery.upsert).toHaveBeenCalledWith(expect.objectContaining({
            idempotency_key: 'crm:session-outcome:activity:complete:session-1',
        }), {
            onConflict: 'idempotency_key',
            ignoreDuplicates: true,
        });
        expect(lookupQuery.eq).toHaveBeenCalledWith(
            'idempotency_key',
            'crm:session-outcome:activity:complete:session-1',
        );
    });

    it('skips cleanly when CRM tables are not migrated', async () => {
        const contactQuery = createQuery({
            data: null,
            error: { code: '42P01', message: 'relation "crm_contacts" does not exist' },
        });
        const client = {
            from: vi.fn((table: string) => {
                if (table === 'crm_contacts') return contactQuery;
                throw new Error(`Unexpected table ${table}`);
            }),
        };

        const result = await recordCrmActivityForProfile(client as any, {
            profileId: 'profile-1',
            email: 'student@example.com',
            fullName: 'Student One',
            activityType: 'support',
            subject: 'Ticket creado',
            relatedEntityType: 'support_ticket_created',
            relatedEntityId: 'ticket-1',
        });

        expect(result).toEqual({ status: 'skipped', reason: 'crm_not_migrated' });
    });

    it('creates a minimal contact when none exists', async () => {
        const byProfileQuery = createQuery({ data: null, error: null });
        const byEmailQuery = createQuery({ data: null, error: null });
        const insertContactQuery = createQuery({ data: { id: 'contact-new' }, error: null });
        const duplicateQuery = createQuery({ data: null, error: null });
        const insertActivityQuery = createQuery({ data: { id: 'activity-new' }, error: null });
        const contactQueries = [byProfileQuery, byEmailQuery, insertContactQuery];
        const activityQueries = [duplicateQuery, insertActivityQuery];
        const client = {
            from: vi.fn((table: string) => {
                if (table === 'crm_contacts') return contactQueries.shift();
                if (table === 'crm_activities') return activityQueries.shift();
                throw new Error(`Unexpected table ${table}`);
            }),
        };

        const result = await recordCrmActivityForProfile(client as any, {
            profileId: 'profile-1',
            email: 'Student@Example.com',
            fullName: 'Student One',
            lifecycleStage: 'customer',
            activityType: 'class',
            subject: 'Clase programada',
            relatedEntityType: 'session_scheduled',
            relatedEntityId: 'session-1',
        });

        expect(result).toEqual({ status: 'created', activityId: 'activity-new' });
        expect(insertContactQuery.insert).toHaveBeenCalledWith(expect.objectContaining({
            profile_id: 'profile-1',
            primary_email: 'student@example.com',
            full_name: 'Student One',
            lifecycle_stage: 'customer',
        }));
    });
});
