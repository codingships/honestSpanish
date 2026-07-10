import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/lib/supabase-server', () => ({
    createSupabaseServerClient: vi.fn(),
}));

const crmMocks = vi.hoisted(() => ({
    recordCrmActivityForProfileSafe: vi.fn().mockResolvedValue({ status: 'created' }),
}));

vi.mock('../../src/lib/supabase-admin', () => ({
    createSupabaseAdminClient: vi.fn(() => ({ from: vi.fn() })),
}));

vi.mock('../../src/lib/crm/activity-sync', () => ({
    recordCrmActivityForProfileSafe: crmMocks.recordCrmActivityForProfileSafe,
}));

const supportEmailMocks = vi.hoisted(() => ({
    deliverEmail: vi.fn(),
    sendSupportTicketReceivedEmail: vi.fn().mockResolvedValue(true),
}));

vi.mock('../../src/lib/email', () => ({
    deliverEmail: supportEmailMocks.deliverEmail,
    sendSupportTicketReceivedEmail: supportEmailMocks.sendSupportTicketReceivedEmail,
}));

const emailMocks = vi.hoisted(() => ({
    readRuntimeEnv: vi.fn((key: string) => {
        if (key === 'SUPPORT_ALERT_EMAIL') return 'support@example.com';
        return undefined;
    }),
}));

vi.mock('../../src/lib/runtime-env', () => ({
    readRuntimeEnv: emailMocks.readRuntimeEnv,
}));

function postContext(
    body: Record<string, unknown>,
    options: { origin?: string | null; userAgent?: string | null } = {},
) {
    const headers = {
        get: vi.fn((name: string) => {
            const key = name.toLowerCase();
            if (key === 'origin') return options.origin === undefined ? 'http://localhost:4321' : options.origin;
            if (key === 'user-agent') return options.userAgent === undefined ? 'vitest-agent' : options.userAgent;
            return null;
        }),
    };

    return {
        request: {
            url: 'http://localhost:4321/api/support/alert',
            json: vi.fn().mockResolvedValue(body),
            headers,
        },
        cookies: { get: vi.fn(), set: vi.fn() },
    };
}

function createSupportClient(options: {
    user?: { id: string; email: string } | null;
    profile?: { id: string; email: string; full_name: string | null; role: string | null } | null;
    insertError?: { message: string } | null;
} = {}) {
    const user = options.user === undefined
        ? { id: 'user-1', email: 'student@example.com' }
        : options.user;
    const profile = options.profile === undefined
        ? { id: 'user-1', email: 'student@example.com', full_name: 'Student One', role: 'student' }
        : options.profile;
    const insert = vi.fn().mockResolvedValue({ error: options.insertError ?? null });
    const profileChain: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: profile, error: profile ? null : { message: 'missing' } }),
    };

    const client = {
        auth: {
            getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }),
        },
        from: vi.fn((table: string) => {
            if (table === 'profiles') return profileChain;
            if (table === 'support_tickets') return { insert };
            throw new Error(`Unexpected table ${table}`);
        }),
    };

    return { client, insert, profileChain };
}

async function readJson(response: Response) {
    return response.json() as Promise<Record<string, unknown>>;
}

describe('/api/support/alert', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        supportEmailMocks.deliverEmail.mockResolvedValue({ ok: true });
        crmMocks.recordCrmActivityForProfileSafe.mockResolvedValue({ status: 'created' });
        supportEmailMocks.sendSupportTicketReceivedEmail.mockResolvedValue(true);
    });

    it('rejects cross-origin support reports before writing tickets', async () => {
        const { client, insert } = createSupportClient();
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        vi.mocked(createSupabaseServerClient).mockReturnValue(client as any);

        const { POST } = await import('../../src/pages/api/support/alert');
        const response = await POST(postContext({
            issueId: 'payment-problem',
            issueTitle: 'Payment problem',
            message: 'Stripe showed an error.',
        }, { origin: 'https://evil.example' }) as any);

        expect(response.status).toBe(403);
        expect(insert).not.toHaveBeenCalled();
        expect(supportEmailMocks.deliverEmail).not.toHaveBeenCalled();
    });

    it('creates a ticket, normalizes same-origin page URLs and sends an email alert', async () => {
        const { client, insert } = createSupportClient();
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        vi.mocked(createSupabaseServerClient).mockReturnValue(client as any);

        const { POST } = await import('../../src/pages/api/support/alert');
        const response = await POST(postContext({
            issueId: 'missing-meet-link',
            issueTitle: 'No veo el enlace de Meet',
            message: 'La clase empieza pronto y no veo el enlace.',
            pageUrl: 'http://localhost:4321/es/campus/support?card=meet#form',
            locale: 'es',
        }) as any);
        const body = await readJson(response);
        const insertedTicket = insert.mock.calls[0][0];

        expect(response.status).toBe(200);
        expect(body.success).toBe(true);
        expect(body.emailSent).toBe(true);
        expect(body.internalAlertSent).toBe(true);
        expect(body.userEmailSent).toBe(true);
        expect(body.ticketId).toBe(insertedTicket.id);
        expect(insertedTicket).toMatchObject({
            user_id: 'user-1',
            issue_type: 'missing-meet-link',
            issue_title: 'No veo el enlace de Meet',
            message: 'La clase empieza pronto y no veo el enlace.',
            page_url: '/es/campus/support?card=meet#form',
            user_agent: 'vitest-agent',
        });
        expect(insertedTicket.context).toMatchObject({
            locale: 'es',
            profile: {
                email: 'student@example.com',
                full_name: 'Student One',
                role: 'student',
            },
            request: {
                page_url: '/es/campus/support?card=meet#form',
                user_agent: 'vitest-agent',
            },
        });
        expect(supportEmailMocks.sendSupportTicketReceivedEmail).toHaveBeenCalledWith('student@example.com', {
            recipientName: 'Student One',
            issueTitle: 'No veo el enlace de Meet',
            ticketId: body.ticketId,
            supportUrl: 'http://localhost:4321/es/campus/support',
        });
        expect(supportEmailMocks.deliverEmail).toHaveBeenCalledWith(expect.objectContaining({
            to: ['support@example.com'],
            subject: expect.stringContaining('No veo el enlace de Meet'),
            source: 'support_internal_alert',
        }));
        expect(crmMocks.recordCrmActivityForProfileSafe).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({
            profileId: 'user-1',
            email: 'student@example.com',
            activityType: 'support',
            subject: expect.stringContaining('Ticket de soporte creado'),
            relatedEntityType: 'support_ticket_created',
            relatedEntityId: body.ticketId,
        }));
        expect(crmMocks.recordCrmActivityForProfileSafe).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({
            profileId: 'user-1',
            email: 'student@example.com',
            activityType: 'email_out',
            subject: 'Support request received - Espanol Honesto',
            body: 'support_ticket_received',
            relatedEntityType: 'support_ticket_acknowledgement',
            relatedEntityId: body.ticketId,
        }));
    });

    it('keeps the ticket when the email notification fails', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        supportEmailMocks.deliverEmail.mockResolvedValue({
            ok: false,
            reason: 'provider_error',
            error: {
                message: 'Recipient student@example.com was rejected',
                statusCode: 422,
            },
        });
        const { client, insert } = createSupportClient();
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        vi.mocked(createSupabaseServerClient).mockReturnValue(client as any);

        const { POST } = await import('../../src/pages/api/support/alert');
        const response = await POST(postContext({
            issueId: 'payment-problem',
            issueTitle: 'Tengo un problema de pago',
            message: 'No puedo abrir el portal de pagos.',
            pageUrl: 'https://external.example/phishing',
            locale: 'es',
        }) as any);
        const body = await readJson(response);

        expect(response.status).toBe(200);
        expect(body.success).toBe(true);
        expect(body.emailSent).toBe(false);
        expect(body.internalAlertSent).toBe(false);
        expect(body.userEmailSent).toBe(true);
        expect(insert).toHaveBeenCalledWith(expect.objectContaining({
            page_url: null,
        }));
        expect(errorSpy).toHaveBeenCalledWith(
            '[SupportAlert] Ticket created but email alert failed:',
            'Recipient s***t@example.com was rejected status=422'
        );
        expect(errorSpy.mock.calls.flat().join(' ')).not.toContain('student@example.com');
        errorSpy.mockRestore();
    });

    it('rejects unauthenticated and invalid support reports', async () => {
        const unauthenticated = createSupportClient({ user: null });
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        vi.mocked(createSupabaseServerClient).mockReturnValue(unauthenticated.client as any);

        const { POST } = await import('../../src/pages/api/support/alert');
        const invalidPayload = await POST(postContext({
            issueId: 'missing meet link',
            issueTitle: 'No',
            message: 'bad',
        }) as any);
        const unauthorized = await POST(postContext({
            issueId: 'missing-meet-link',
            issueTitle: 'No veo el enlace de Meet',
            message: 'La clase empieza pronto y no veo el enlace.',
        }) as any);

        expect(invalidPayload.status).toBe(400);
        expect(unauthorized.status).toBe(401);
    });
});
