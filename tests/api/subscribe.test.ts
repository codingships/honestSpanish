import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    upsert: vi.fn(),
    adminSend: vi.fn(),
    sendLeadWelcomeEmail: vi.fn(),
    loadLeadCaptureForCrm: vi.fn(),
    syncLeadCaptureToCrmSafe: vi.fn(),
    recordLeadEmailOutInCrmSafe: vi.fn(),
    readRuntimeEnv: vi.fn((key: string) => {
        if (key === 'TURNSTILE_SECRET_KEY') return 'turnstile-secret';
        if (key === 'ADMIN_EMAIL') return 'alejandro@espanolhonesto.com';
        if (key === 'EMAIL_FROM') return 'Academia <hello@example.com>';
        return undefined;
    }),
}));

vi.mock('../../src/lib/supabase-admin', () => ({
    createSupabaseAdminClient: vi.fn(() => ({
        from: vi.fn((table: string) => {
            if (table !== 'leads') throw new Error(`Unexpected table ${table}`);
            return { upsert: mocks.upsert };
        }),
    })),
}));

vi.mock('../../src/lib/runtime-env', () => ({
    readRuntimeEnv: mocks.readRuntimeEnv,
    requireRuntimeEnv: mocks.readRuntimeEnv,
}));

vi.mock('../../src/lib/email', () => ({
    getEmailFrom: vi.fn(() => 'Academia <hello@example.com>'),
    getResend: vi.fn(() => ({
        emails: {
            send: mocks.adminSend,
        },
    })),
    sendLeadWelcomeEmail: mocks.sendLeadWelcomeEmail,
}));

vi.mock('../../src/lib/crm/lead-capture', () => ({
    loadLeadCaptureForCrm: mocks.loadLeadCaptureForCrm,
    syncLeadCaptureToCrmSafe: mocks.syncLeadCaptureToCrmSafe,
    recordLeadEmailOutInCrmSafe: mocks.recordLeadEmailOutInCrmSafe,
}));

function postContext(body: Record<string, unknown>) {
    return {
        request: {
            json: vi.fn().mockResolvedValue(body),
        },
        clientAddress: '203.0.113.10',
    };
}

describe('/api/subscribe', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.upsert.mockResolvedValue({ error: null });
        mocks.adminSend.mockReturnValue(Promise.resolve({ error: null }));
        mocks.sendLeadWelcomeEmail.mockResolvedValue(true);
        mocks.loadLeadCaptureForCrm.mockResolvedValue({
            id: '00000000-0000-4000-8000-000000000001',
            email: 'future.student@example.com',
            name: 'Future Student',
            interest: 'general',
            current_level: 'b1',
            learning_goal: 'Quiero vivir en España y hablar mejor con gente real.',
            availability: 'Tardes entre semana.',
            preferred_package: 'hybrid',
            source_path: '/es/espanol-para-vivir-en-espana',
            lang: 'es',
            spoken_languages: ['ru', 'en'],
            is_russian_speaker: true,
            consent_given: true,
            status: 'new',
            created_at: '2026-06-25T10:00:00.000Z',
            updated_at: '2026-06-25T10:00:00.000Z',
            crm_contact_id: null,
            crm_opportunity_id: null,
        });
        mocks.syncLeadCaptureToCrmSafe.mockResolvedValue({
            status: 'synced',
            contactId: '10000000-0000-4000-8000-000000000001',
            opportunityId: '20000000-0000-4000-8000-000000000001',
            taskId: '30000000-0000-4000-8000-000000000001',
        });
        mocks.recordLeadEmailOutInCrmSafe.mockResolvedValue({ status: 'created', activityId: 'activity-1' });
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            json: vi.fn().mockResolvedValue({ success: true }),
        }));
    });

    it('upserts enriched application details by normalized email', async () => {
        const { POST } = await import('../../src/pages/api/subscribe');
        const response = await POST(postContext({
            email: '  Future.Student@Example.COM ',
            name: ' Future Student ',
            interest: 'general',
            currentLevel: 'b1',
            learningGoal: 'Quiero vivir en España y hablar mejor con gente real.',
            availability: 'Tardes entre semana.',
            preferredPackage: 'hybrid',
            spokenLanguages: ['Russian', 'English'],
            otherLanguages: 'Romanian',
            sourcePath: '/es/espanol-para-vivir-en-espana',
            lang: 'es',
            consent: true,
            'cf-turnstile-response': 'turnstile-token',
        }) as any);

        expect(response.status).toBe(200);
        const turnstileBody = vi.mocked(fetch).mock.calls[0]?.[1]?.body;
        expect(turnstileBody).toBeInstanceOf(URLSearchParams);
        expect((turnstileBody as URLSearchParams).get('secret')).toBe('turnstile-secret');
        expect((turnstileBody as URLSearchParams).get('response')).toBe('turnstile-token');
        expect((turnstileBody as URLSearchParams).get('remoteip')).toBe('203.0.113.10');
        expect(mocks.upsert).toHaveBeenCalledWith({
            email: 'future.student@example.com',
            name: 'Future Student',
            interest: 'general',
            current_level: 'b1',
            learning_goal: 'Quiero vivir en España y hablar mejor con gente real.',
            availability: 'Tardes entre semana.',
            preferred_package: 'hybrid',
            source_path: '/es/espanol-para-vivir-en-espana',
            lang: 'es',
            spoken_languages: ['ru', 'en', 'romanian'],
            is_russian_speaker: true,
            consent_given: true,
            ip_address: '203.0.113.10',
            status: 'new',
            updated_at: expect.any(String),
        }, {
            onConflict: 'email',
        });
        expect(mocks.adminSend).toHaveBeenCalledWith(expect.objectContaining({
            to: ['alejandro@espanolhonesto.com'],
            subject: expect.stringContaining('Future Student'),
        }));
        expect(mocks.sendLeadWelcomeEmail).toHaveBeenCalledWith('future.student@example.com', {
            recipientName: 'Future Student',
        });
        expect(mocks.loadLeadCaptureForCrm).toHaveBeenCalledWith(expect.anything(), 'future.student@example.com');
        expect(mocks.syncLeadCaptureToCrmSafe).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
            id: '00000000-0000-4000-8000-000000000001',
            email: 'future.student@example.com',
        }));
        expect(mocks.recordLeadEmailOutInCrmSafe).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
            contactId: '10000000-0000-4000-8000-000000000001',
            opportunityId: '20000000-0000-4000-8000-000000000001',
            subject: 'Application received - Espanol Honesto',
            template: 'lead_welcome',
        }));
    });

    it('rejects failed Turnstile before writing the lead', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            json: vi.fn().mockResolvedValue({ success: false }),
        }));

        const { POST } = await import('../../src/pages/api/subscribe');
        const response = await POST(postContext({
            email: 'student@example.com',
            consent: true,
            'cf-turnstile-response': 'bad-token',
        }) as any);

        expect(response.status).toBe(403);
        expect(mocks.upsert).not.toHaveBeenCalled();
        expect(mocks.adminSend).not.toHaveBeenCalled();
        expect(mocks.syncLeadCaptureToCrmSafe).not.toHaveBeenCalled();
    });

    it('keeps lead capture working if preferred_package migration is not applied yet', async () => {
        mocks.upsert
            .mockResolvedValueOnce({
                error: {
                    code: 'PGRST204',
                    message: "Could not find the 'preferred_package' column of 'leads' in the schema cache",
                },
            })
            .mockResolvedValueOnce({ error: null });

        const { POST } = await import('../../src/pages/api/subscribe');
        const response = await POST(postContext({
            email: 'student@example.com',
            name: 'Student',
            interest: 'general',
            preferredPackage: 'group',
            lang: 'es',
            consent: true,
            'cf-turnstile-response': 'turnstile-token',
        }) as any);

        expect(response.status).toBe(200);
        expect(mocks.upsert).toHaveBeenCalledTimes(2);
        expect(mocks.upsert.mock.calls[0][0]).toMatchObject({ preferred_package: 'group' });
        expect(mocks.upsert.mock.calls[1][0]).not.toHaveProperty('preferred_package');
        expect(mocks.upsert.mock.calls[1][0]).not.toHaveProperty('spoken_languages');
        expect(mocks.upsert.mock.calls[1][0]).not.toHaveProperty('is_russian_speaker');
        expect(mocks.adminSend).toHaveBeenCalled();
    });

    it('does not record a CRM email activity when the lead confirmation email fails', async () => {
        mocks.sendLeadWelcomeEmail.mockResolvedValue(false);

        const { POST } = await import('../../src/pages/api/subscribe');
        const response = await POST(postContext({
            email: 'student@example.com',
            name: 'Student',
            interest: 'general',
            lang: 'en',
            consent: true,
            'cf-turnstile-response': 'turnstile-token',
        }) as any);

        expect(response.status).toBe(200);
        expect(mocks.syncLeadCaptureToCrmSafe).toHaveBeenCalled();
        expect(mocks.recordLeadEmailOutInCrmSafe).not.toHaveBeenCalled();
    });

    it('uses normalized lead fields in admin notifications when JSON contains unexpected types', async () => {
        const { POST } = await import('../../src/pages/api/subscribe');
        const response = await POST(postContext({
            email: 'student@example.com',
            name: { display: 'not-a-string' },
            interest: ['general'],
            consent: true,
            'cf-turnstile-response': 'turnstile-token',
        }) as any);

        expect(response.status).toBe(200);
        expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({
            email: 'student@example.com',
            name: null,
            interest: null,
        }), {
            onConflict: 'email',
        });
        expect(mocks.adminSend).toHaveBeenCalledWith(expect.objectContaining({
            subject: 'Nuevo Lead: N/A (N/A)',
        }));
    });
});
