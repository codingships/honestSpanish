import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    insert: vi.fn(),
    update: vi.fn(),
    updateEq: vi.fn(),
    deliverEmail: vi.fn(),
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
            return { insert: mocks.insert, update: mocks.update };
        }),
    })),
}));

vi.mock('../../src/lib/runtime-env', () => ({
    readRuntimeEnv: mocks.readRuntimeEnv,
    requireRuntimeEnv: mocks.readRuntimeEnv,
}));

vi.mock('../../src/lib/email', () => ({
    deliverEmail: mocks.deliverEmail,
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
        mocks.insert.mockResolvedValue({ error: null });
        mocks.updateEq.mockResolvedValue({ error: null });
        mocks.update.mockReturnValue({ eq: mocks.updateEq });
        mocks.deliverEmail.mockResolvedValue({ ok: true });
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

    it('inserts enriched application details by normalized email', async () => {
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
            adultConfirmed: true,
            consent: true,
            'cf-turnstile-response': 'turnstile-token',
        }) as any);

        expect(response.status).toBe(200);
        const turnstileBody = vi.mocked(fetch).mock.calls[0]?.[1]?.body;
        expect(turnstileBody).toBeInstanceOf(URLSearchParams);
        expect((turnstileBody as URLSearchParams).get('secret')).toBe('turnstile-secret');
        expect((turnstileBody as URLSearchParams).get('response')).toBe('turnstile-token');
        expect((turnstileBody as URLSearchParams).get('remoteip')).toBe('203.0.113.10');
        expect(mocks.insert).toHaveBeenCalledWith({
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
            adult_confirmed: true,
            adult_confirmed_at: expect.any(String),
            age_policy_version: '2026-07-10',
            consent_given: true,
            ip_address: '203.0.113.10',
            status: 'new',
            updated_at: expect.any(String),
        });
        expect(mocks.deliverEmail).toHaveBeenCalledWith(expect.objectContaining({
            to: ['alejandro@espanolhonesto.com'],
            subject: expect.stringContaining('Future Student'),
            source: 'lead_admin_notification',
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

    it('redacts admin notification provider errors without failing lead capture', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        mocks.deliverEmail.mockResolvedValueOnce({
            ok: false,
            reason: 'provider_error',
            error: {
                message: 'Recipient future.student@example.com was rejected',
                statusCode: 422,
            },
        });

        const { POST } = await import('../../src/pages/api/subscribe');
        const response = await POST(postContext({
            email: 'future.student@example.com',
            name: 'Future Student',
            interest: 'general',
            lang: 'es',
            adultConfirmed: true,
            consent: true,
            'cf-turnstile-response': 'turnstile-token',
        }) as any);
        await Promise.resolve();

        expect(response.status).toBe(200);
        expect(errorSpy).toHaveBeenCalledWith(
            'Error notifying admin:',
            'Recipient f***t@example.com was rejected status=422'
        );
        expect(errorSpy.mock.calls.flat().join(' ')).not.toContain('future.student@example.com');
        errorSpy.mockRestore();
    });

    it('redacts thrown lead email errors before returning a generic failure', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        mocks.sendLeadWelcomeEmail.mockRejectedValueOnce({
            message: 'Recipient student@example.com was rejected',
            statusCode: 503,
        });

        try {
            const { POST } = await import('../../src/pages/api/subscribe');
            const response = await POST(postContext({
                email: 'student@example.com',
                name: 'Student',
                interest: 'general',
                lang: 'es',
                adultConfirmed: true,
                consent: true,
                'cf-turnstile-response': 'turnstile-token',
            }) as any);
            const body = await response.json() as JsonBody;

            expect(response.status).toBe(500);
            expect(body).toEqual({ error: 'Error al enviar email' });
            expect(errorSpy).toHaveBeenCalledWith(
                '[Subscribe] Lead/email flow error:',
                'Recipient s***t@example.com was rejected status=503'
            );
            expect(errorSpy.mock.calls.flat().join(' ')).not.toContain('student@example.com');
        } finally {
            errorSpy.mockRestore();
        }
    });

    it('rejects failed Turnstile before writing the lead', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            json: vi.fn().mockResolvedValue({ success: false }),
        }));

        const { POST } = await import('../../src/pages/api/subscribe');
        const response = await POST(postContext({
            email: 'student@example.com',
            adultConfirmed: true,
            consent: true,
            'cf-turnstile-response': 'bad-token',
        }) as any);

        expect(response.status).toBe(403);
        expect(mocks.insert).not.toHaveBeenCalled();
        expect(mocks.deliverEmail).not.toHaveBeenCalled();
        expect(mocks.syncLeadCaptureToCrmSafe).not.toHaveBeenCalled();
    });

    it('keeps lead capture working if preferred_package migration is not applied yet', async () => {
        mocks.insert
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
            adultConfirmed: true,
            consent: true,
            'cf-turnstile-response': 'turnstile-token',
        }) as any);

        expect(response.status).toBe(200);
        expect(mocks.insert).toHaveBeenCalledTimes(2);
        expect(mocks.insert.mock.calls[0][0]).toMatchObject({ preferred_package: 'group' });
        expect(mocks.insert.mock.calls[1][0]).not.toHaveProperty('preferred_package');
        expect(mocks.insert.mock.calls[1][0]).not.toHaveProperty('spoken_languages');
        expect(mocks.insert.mock.calls[1][0]).not.toHaveProperty('is_russian_speaker');
        expect(mocks.deliverEmail).toHaveBeenCalled();
    });

    it('returns success without overwriting or syncing an existing email', async () => {
        mocks.insert.mockResolvedValue({
            error: {
                code: '23505',
                message: 'duplicate key value violates unique constraint "leads_email_key"',
            },
        });

        const { POST } = await import('../../src/pages/api/subscribe');
        const response = await POST(postContext({
            email: 'existing@example.com',
            name: 'Attacker Chosen Name',
            interest: 'general',
            lang: 'en',
            adultConfirmed: true,
            consent: true,
            'cf-turnstile-response': 'turnstile-token',
        }) as any);
        const body = await response.json() as JsonBody;

        expect(response.status).toBe(200);
        expect(body).toEqual({ message: 'Success' });
        expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({
            adult_confirmed: true,
            age_policy_version: '2026-07-10',
            consent_given: true,
        }));
        expect(mocks.update.mock.calls[0][0]).not.toHaveProperty('name');
        expect(mocks.loadLeadCaptureForCrm).not.toHaveBeenCalled();
        expect(mocks.syncLeadCaptureToCrmSafe).not.toHaveBeenCalled();
        expect(mocks.deliverEmail).not.toHaveBeenCalled();
        expect(mocks.sendLeadWelcomeEmail).not.toHaveBeenCalled();
    });

    it('does not record a CRM email activity when the lead confirmation email fails', async () => {
        mocks.sendLeadWelcomeEmail.mockResolvedValue(false);

        const { POST } = await import('../../src/pages/api/subscribe');
        const response = await POST(postContext({
            email: 'student@example.com',
            name: 'Student',
            interest: 'general',
            lang: 'en',
            adultConfirmed: true,
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
            adultConfirmed: true,
            consent: true,
            'cf-turnstile-response': 'turnstile-token',
        }) as any);

        expect(response.status).toBe(200);
        expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({
            email: 'student@example.com',
            name: null,
            interest: null,
        }));
        expect(mocks.deliverEmail).toHaveBeenCalledWith(expect.objectContaining({
            subject: 'Nuevo Lead: N/A (N/A)',
        }));
    });
});
