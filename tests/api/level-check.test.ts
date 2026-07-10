import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    queues: {} as Record<string, any[]>,
    from: vi.fn(),
    readRuntimeEnv: vi.fn((key: string) => {
        if (key === 'TURNSTILE_SECRET_KEY') return 'turnstile-secret';
        return undefined;
    }),
    loadLeadCaptureForCrm: vi.fn(),
    syncLeadCaptureToCrmSafe: vi.fn(),
    recordLevelCheckInCrmSafe: vi.fn(),
    verifyLeadEmailToken: vi.fn(),
}));

vi.mock('../../src/lib/supabase-admin', () => ({
    createSupabaseAdminClient: vi.fn(() => ({
        from: mocks.from,
    })),
}));

vi.mock('../../src/lib/runtime-env', () => ({
    readRuntimeEnv: mocks.readRuntimeEnv,
}));

vi.mock('../../src/lib/crm/lead-capture', () => ({
    loadLeadCaptureForCrm: mocks.loadLeadCaptureForCrm,
    syncLeadCaptureToCrmSafe: mocks.syncLeadCaptureToCrmSafe,
}));

vi.mock('../../src/lib/crm/level-check', () => ({
    recordLevelCheckInCrmSafe: mocks.recordLevelCheckInCrmSafe,
}));

vi.mock('../../src/lib/lead-email-token', () => ({
    verifyLeadEmailToken: mocks.verifyLeadEmailToken,
}));

type QueryResult = { data: unknown; error: unknown };

function createQuery(result: QueryResult, recorder?: {
    inserts?: unknown[];
    updates?: unknown[];
}) {
    const query: any = {
        select: vi.fn(() => query),
        eq: vi.fn(() => query),
        maybeSingle: vi.fn().mockResolvedValue(result),
        single: vi.fn().mockResolvedValue(result),
        update: vi.fn((value: unknown) => {
            recorder?.updates?.push(value);
            return query;
        }),
        insert: vi.fn((value: unknown) => {
            recorder?.inserts?.push(value);
            return query;
        }),
    };
    return query;
}

function postContext(body: Record<string, unknown>) {
    return {
        request: {
            json: vi.fn().mockResolvedValue(body),
        },
        clientAddress: '203.0.113.20',
    };
}

const validPayload = {
    email: ' Future.Student@Example.COM ',
    currentLevel: 'b1',
    comprehensionComfort: 'depends_context',
    speakingBlocker: 'culture',
    useContext: 'I need Spanish for work, meetings and life in Spain.',
    writtenSample: 'Hola, soy una persona que trabaja con clientes espanoles y quiero hablar con mas naturalidad en reuniones.',
    canSendAudioLater: true,
    lang: 'en',
    sourcePath: '/en/diagnostico',
    adultConfirmed: true,
    consent: true,
    'cf-turnstile-response': 'turnstile-token',
};

const crmLead = {
    id: '00000000-0000-4000-8000-000000000001',
    email: 'future.student@example.com',
    name: null,
    interest: null,
    current_level: 'b1',
    learning_goal: null,
    availability: null,
    preferred_package: null,
    source_path: '/en/diagnostico',
    lang: 'en',
    spoken_languages: [],
    is_russian_speaker: false,
    consent_given: true,
    status: 'new',
    created_at: '2026-06-25T10:00:00.000Z',
    updated_at: '2026-06-25T10:00:00.000Z',
    crm_contact_id: null,
    crm_opportunity_id: null,
};

describe('/api/level-check', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        mocks.queues = {};
        mocks.from.mockImplementation((table: string) => {
            const query = mocks.queues[table]?.shift();
            if (!query) throw new Error(`Unexpected table query: ${table}`);
            return query;
        });
        mocks.loadLeadCaptureForCrm.mockResolvedValue(crmLead);
        mocks.syncLeadCaptureToCrmSafe.mockResolvedValue({
            status: 'synced',
            contactId: '10000000-0000-4000-8000-000000000001',
            opportunityId: '20000000-0000-4000-8000-000000000001',
            taskId: '30000000-0000-4000-8000-000000000001',
        });
        mocks.recordLevelCheckInCrmSafe.mockResolvedValue({ status: 'recorded', activityId: 'activity-1', taskId: 'task-1' });
        mocks.verifyLeadEmailToken.mockResolvedValue(true);
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            json: vi.fn().mockResolvedValue({ success: true }),
        }));
    });

    it('updates an existing lead with temporary diagnostic context and creates CRM review work', async () => {
        const updates: unknown[] = [];
        mocks.queues.leads = [
            createQuery({ data: { id: crmLead.id, email: crmLead.email, status: 'new' }, error: null }),
            createQuery({ data: { id: crmLead.id }, error: null }, { updates }),
        ];

        const { POST } = await import('../../src/pages/api/level-check');
        const response = await POST(postContext({
            ...validPayload,
            leadId: crmLead.id,
            token: 'signed-token',
        }) as any);
        const body = await response.json() as JsonBody;

        expect(response.status).toBe(200);
        expect(body).toEqual({ message: 'Success' });
        const turnstileBody = vi.mocked(fetch).mock.calls[0]?.[1]?.body;
        expect(turnstileBody).toBeInstanceOf(URLSearchParams);
        expect((turnstileBody as URLSearchParams).get('secret')).toBe('turnstile-secret');
        expect((turnstileBody as URLSearchParams).get('response')).toBe('turnstile-token');
        expect((turnstileBody as URLSearchParams).get('remoteip')).toBe('203.0.113.20');

        expect(updates).toHaveLength(1);
        expect(mocks.verifyLeadEmailToken).toHaveBeenCalledWith({
            leadId: crmLead.id,
            email: 'future.student@example.com',
            token: 'signed-token',
        });
        expect(updates[0]).toMatchObject({
            adult_confirmed: true,
            adult_confirmed_at: expect.any(String),
            age_policy_version: '2026-07-10',
            current_level: 'b1',
            lang: 'en',
            consent_given: true,
            level_check_status: 'received',
            level_check_estimated_level: 'b1',
            level_check_confidence: 'low',
            level_check_fit_flags: expect.arrayContaining([
                'plateau_candidate',
                'culture_context_signal',
                'audio_optional_available',
            ]),
            level_check_received_at: expect.any(String),
            updated_at: expect.any(String),
        });
        expect(updates[0]).toMatchObject({
            level_check_context: expect.objectContaining({
                current_level: 'b1',
                comprehension_comfort: 'depends_context',
                speaking_blocker: 'culture',
                written_sample: validPayload.writtenSample,
                retention: 'clear_raw_if_discarded',
            }),
        });

        expect(mocks.loadLeadCaptureForCrm).toHaveBeenCalledWith(expect.anything(), 'future.student@example.com');
        expect(mocks.syncLeadCaptureToCrmSafe).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
            email: 'future.student@example.com',
        }));
        expect(mocks.recordLevelCheckInCrmSafe).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
            contactId: '10000000-0000-4000-8000-000000000001',
            opportunityId: '20000000-0000-4000-8000-000000000001',
            summary: expect.stringContaining('Self-reported level: B1.'),
            metadata: expect.objectContaining({
                raw_context_location: 'leads.level_check_context',
                written_sample_characters: validPayload.writtenSample.length,
            }),
        }));
        expect(mocks.recordLevelCheckInCrmSafe.mock.calls[0][1].metadata).not.toHaveProperty('written_sample');
    });

    it('does not overwrite an existing lead when the public diagnostic has no signed token', async () => {
        const updates: unknown[] = [];
        mocks.queues.leads = [
            createQuery({ data: { id: crmLead.id, email: crmLead.email, status: 'new' }, error: null }),
            createQuery({ data: { id: crmLead.id }, error: null }, { updates }),
        ];

        const { POST } = await import('../../src/pages/api/level-check');
        const response = await POST(postContext(validPayload) as any);
        const body = await response.json() as JsonBody;

        expect(response.status).toBe(200);
        expect(body).toEqual({ message: 'Success' });
        expect(updates).toHaveLength(0);
        expect(mocks.verifyLeadEmailToken).not.toHaveBeenCalled();
        expect(mocks.loadLeadCaptureForCrm).not.toHaveBeenCalled();
        expect(mocks.syncLeadCaptureToCrmSafe).not.toHaveBeenCalled();
        expect(mocks.recordLevelCheckInCrmSafe).not.toHaveBeenCalled();
    });

    it('creates a minimal lead if the diagnostic link is opened before an application exists', async () => {
        const inserts: unknown[] = [];
        mocks.queues.leads = [
            createQuery({ data: null, error: null }),
            createQuery({ data: { id: crmLead.id }, error: null }, { inserts }),
        ];

        const { POST } = await import('../../src/pages/api/level-check');
        const response = await POST(postContext(validPayload) as any);

        expect(response.status).toBe(200);
        expect(inserts).toHaveLength(1);
        expect(inserts[0]).toMatchObject({
            email: 'future.student@example.com',
            status: 'new',
            adult_confirmed: true,
            age_policy_version: '2026-07-10',
            level_check_status: 'received',
            source_path: '/en/diagnostico',
        });
    });

    it('rejects failed Turnstile before touching Supabase or CRM', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            json: vi.fn().mockResolvedValue({ success: false }),
        }));

        const { POST } = await import('../../src/pages/api/level-check');
        const response = await POST(postContext(validPayload) as any);

        expect(response.status).toBe(403);
        expect(mocks.from).not.toHaveBeenCalled();
        expect(mocks.loadLeadCaptureForCrm).not.toHaveBeenCalled();
        expect(mocks.recordLevelCheckInCrmSafe).not.toHaveBeenCalled();
    });

    it('rejects diagnostics without an explicit adult confirmation before Turnstile', async () => {
        const { POST } = await import('../../src/pages/api/level-check');
        const response = await POST(postContext({
            ...validPayload,
            adultConfirmed: false,
        }) as any);

        expect(response.status).toBe(400);
        expect(fetch).not.toHaveBeenCalled();
        expect(mocks.from).not.toHaveBeenCalled();
    });
});
