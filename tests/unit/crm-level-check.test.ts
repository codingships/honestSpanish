import { describe, expect, it, vi } from 'vitest';
import { recordLevelCheckInCrm } from '../../src/lib/crm/level-check';

function createQuery(result: { data: unknown; error: unknown }, recorder?: {
    inserts?: unknown[];
    updates?: unknown[];
}) {
    const query: any = {
        select: vi.fn(() => query),
        eq: vi.fn(() => query),
        in: vi.fn(() => query),
        insert: vi.fn((value: unknown) => {
            recorder?.inserts?.push(value);
            return query;
        }),
        update: vi.fn((value: unknown) => {
            recorder?.updates?.push(value);
            return query;
        }),
        maybeSingle: vi.fn().mockResolvedValue(result),
        single: vi.fn().mockResolvedValue(result),
        then: (resolve: (value: typeof result) => unknown, reject: (reason: unknown) => unknown) =>
            Promise.resolve(result).then(resolve, reject),
    };
    return query;
}

function createClient(queues: Record<string, any[]>) {
    return {
        from: vi.fn((table: string) => {
            const query = queues[table]?.shift();
            if (!query) throw new Error(`Unexpected table query: ${table}`);
            return query;
        }),
    };
}

const lead = {
    id: '00000000-0000-4000-8000-000000000071',
    email: 'Student@Example.com',
    name: 'Student',
    interest: null,
    current_level: 'b1',
    learning_goal: null,
    availability: null,
    preferred_package: null,
    source_path: '/en/diagnostico',
    lang: 'en',
    spoken_languages: ['ru'],
    is_russian_speaker: true,
    consent_given: true,
    status: 'contacted' as const,
    created_at: '2026-06-26T09:00:00.000Z',
    updated_at: '2026-06-26T09:00:00.000Z',
    crm_contact_id: null,
    crm_opportunity_id: null,
};

describe('recordLevelCheckInCrm', () => {
    it('refreshes an existing open review task when a diagnostic is resubmitted', async () => {
        const activityUpdates: unknown[] = [];
        const taskUpdates: unknown[] = [];
        const existingActivityQuery = createQuery({ data: { id: 'activity-existing' }, error: null });
        const updateActivityQuery = createQuery({ data: null, error: null }, { updates: activityUpdates });
        const findTaskQuery = createQuery({ data: { id: 'task-existing' }, error: null });
        const updateTaskQuery = createQuery({ data: null, error: null }, { updates: taskUpdates });
        const client = createClient({
            crm_activities: [existingActivityQuery, updateActivityQuery],
            crm_tasks: [findTaskQuery, updateTaskQuery],
        });

        const result = await recordLevelCheckInCrm(client as any, {
            lead,
            contactId: 'contact-1',
            opportunityId: 'opportunity-1',
            summary: 'Updated diagnostic summary.',
            receivedAt: '2026-06-26T10:00:00.000Z',
            metadata: {
                source: 'level_check',
                current_level: 'b1',
                fit_flags: ['plateau_candidate', 'culture_context_signal'],
                raw_context_location: 'leads.level_check_context',
                written_sample: 'temporary raw sample must not enter CRM metadata',
                level_check_context: { written_sample: 'nested raw sample must not enter CRM metadata' },
            },
        });

        expect(result).toEqual({
            status: 'recorded',
            activityId: 'activity-existing',
            taskId: 'task-existing',
        });
        expect(activityUpdates).toEqual([expect.objectContaining({
            body: 'Updated diagnostic summary.',
            occurred_at: '2026-06-26T10:00:00.000Z',
            metadata: expect.objectContaining({
                source: 'level_check',
                current_level: 'b1',
                fit_flags: ['plateau_candidate', 'culture_context_signal'],
                raw_context_location: 'leads.level_check_context',
            }),
        })]);
        expect((activityUpdates[0] as { metadata: Record<string, unknown> }).metadata).not.toHaveProperty('written_sample');
        expect((activityUpdates[0] as { metadata: Record<string, unknown> }).metadata).not.toHaveProperty('level_check_context');
        expect(updateActivityQuery.eq).toHaveBeenCalledWith('id', 'activity-existing');
        expect(findTaskQuery.in).toHaveBeenCalledWith('status', ['open', 'snoozed']);
        expect(taskUpdates).toEqual([expect.objectContaining({
            status: 'open',
            due_at: '2026-06-27T10:00:00.000Z',
            updated_at: '2026-06-26T10:00:00.000Z',
            metadata: expect.objectContaining({
                source: 'level_check',
                current_level: 'b1',
                fit_flags: ['plateau_candidate', 'culture_context_signal'],
                raw_context_location: 'leads.level_check_context',
                summary: 'Updated diagnostic summary.',
                email: 'student@example.com',
                received_at: '2026-06-26T10:00:00.000Z',
            }),
        })]);
        expect((taskUpdates[0] as { metadata: Record<string, unknown> }).metadata).not.toHaveProperty('written_sample');
        expect((taskUpdates[0] as { metadata: Record<string, unknown> }).metadata).not.toHaveProperty('level_check_context');
        expect(updateTaskQuery.eq).toHaveBeenCalledWith('id', 'task-existing');
    });

    it('creates a new review task when there is no open or snoozed diagnostic task', async () => {
        const activityUpdates: unknown[] = [];
        const taskInserts: unknown[] = [];
        const existingActivityQuery = createQuery({ data: { id: 'activity-existing' }, error: null });
        const updateActivityQuery = createQuery({ data: null, error: null }, { updates: activityUpdates });
        const findTaskQuery = createQuery({ data: null, error: null });
        const insertTaskQuery = createQuery({ data: { id: 'task-new' }, error: null }, { inserts: taskInserts });
        const client = createClient({
            crm_activities: [existingActivityQuery, updateActivityQuery],
            crm_tasks: [findTaskQuery, insertTaskQuery],
        });

        const result = await recordLevelCheckInCrm(client as any, {
            lead,
            contactId: 'contact-1',
            opportunityId: 'opportunity-1',
            summary: 'Fresh diagnostic summary.',
            receivedAt: '2026-06-26T11:00:00.000Z',
            metadata: { source: 'level_check' },
        });

        expect(result).toEqual({
            status: 'recorded',
            activityId: 'activity-existing',
            taskId: 'task-new',
        });
        expect(activityUpdates).toEqual([expect.objectContaining({
            body: 'Fresh diagnostic summary.',
            occurred_at: '2026-06-26T11:00:00.000Z',
            metadata: { source: 'level_check' },
        })]);
        expect(findTaskQuery.in).toHaveBeenCalledWith('status', ['open', 'snoozed']);
        expect(taskInserts).toEqual([expect.objectContaining({
            contact_id: 'contact-1',
            opportunity_id: 'opportunity-1',
            title: 'Review lightweight level check',
            task_type: 'review',
            priority: 'high',
            due_at: '2026-06-27T11:00:00.000Z',
            related_entity_type: 'level_check',
            related_entity_id: lead.id,
            metadata: expect.objectContaining({
                source: 'level_check',
                summary: 'Fresh diagnostic summary.',
                email: 'student@example.com',
                received_at: '2026-06-26T11:00:00.000Z',
            }),
        })]);
    });
});
