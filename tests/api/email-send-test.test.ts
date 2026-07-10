import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockSupabaseClient, createUnauthenticatedMockClient } from '../mocks/supabase';

vi.mock('../../src/lib/supabase-server', () => ({
    createSupabaseServerClient: vi.fn(),
}));

vi.mock('../../src/lib/email/previews', () => {
    const emailPreviewTypes = [
        'welcome',
        'confirmation',
        'reminder',
        'cancelled',
        'lead',
        'level-check',
        'missing-info',
        'proposal-next-step',
        'support-received',
        'support-updated',
    ];
    return {
        emailPreviewTypes,
        isEmailPreviewType: vi.fn((value: string) => emailPreviewTypes.includes(value)),
        buildEmailPreview: vi.fn((type: string) => ({
            type,
            subject: `Subject ${type}`,
            html: `<p>${type}</p>`,
        })),
        sendEmailPreview: vi.fn().mockResolvedValue(true),
    };
});

function createRoleClient(role: string) {
    const chain: any = {};
    chain.select = vi.fn().mockReturnValue(chain);
    chain.eq = vi.fn().mockReturnValue(chain);
    chain.single = vi.fn().mockResolvedValue({ data: { role }, error: null });

    return createMockSupabaseClient({
        from: vi.fn(() => chain),
    });
}

function getContext(type = 'welcome') {
    return {
        request: {
            url: `http://localhost:4321/api/email/send-test?type=${type}`,
        },
        cookies: { get: vi.fn(), set: vi.fn() },
    };
}

function postContext(body: Record<string, unknown>) {
    return {
        request: {
            url: 'http://localhost:4321/api/email/send-test',
            json: vi.fn().mockResolvedValue(body),
        },
        cookies: { get: vi.fn(), set: vi.fn() },
    };
}

async function readJson(response: Response) {
    return response.json() as Promise<Record<string, unknown>>;
}

describe('/api/email/send-test', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns an email preview for admins without sending email', async () => {
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { buildEmailPreview, sendEmailPreview } = await import('../../src/lib/email/previews');
        vi.mocked(createSupabaseServerClient).mockReturnValue(createRoleClient('admin') as any);

        const { GET } = await import('../../src/pages/api/email/send-test');
        const response = await GET(getContext('welcome') as any);
        const body = await readJson(response);

        expect(response.status).toBe(200);
        expect(body.subject).toBe('Subject welcome');
        expect(body.html).toBe('<p>welcome</p>');
        expect(buildEmailPreview).toHaveBeenCalledWith('welcome');
        expect(sendEmailPreview).not.toHaveBeenCalled();
    });

    it('sends a test email for admins', async () => {
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { sendEmailPreview } = await import('../../src/lib/email/previews');
        vi.mocked(createSupabaseServerClient).mockReturnValue(createRoleClient('admin') as any);

        const { POST } = await import('../../src/pages/api/email/send-test');
        const response = await POST(postContext({ type: 'support-updated', email: 'admin@example.com' }) as any);
        const body = await readJson(response);

        expect(response.status).toBe(200);
        expect(body.success).toBe(true);
        expect(sendEmailPreview).toHaveBeenCalledWith('support-updated', 'admin@example.com');
    });

    it('redacts provider errors when a test email throws', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { sendEmailPreview } = await import('../../src/lib/email/previews');
        vi.mocked(createSupabaseServerClient).mockReturnValue(createRoleClient('admin') as any);
        vi.mocked(sendEmailPreview).mockRejectedValueOnce({
            message: 'Recipient preview.target@example.com was rejected',
            statusCode: 422,
        });

        try {
            const { POST } = await import('../../src/pages/api/email/send-test');
            const response = await POST(postContext({ type: 'support-updated', email: 'preview.target@example.com' }) as any);
            const body = await readJson(response);

            expect(response.status).toBe(500);
            expect(body.error).toBe('Failed to send test email');
            expect(errorSpy).toHaveBeenCalledWith(
                '[EmailTest] Error sending preview:',
                'Recipient p***t@example.com was rejected status=422'
            );
            expect(errorSpy.mock.calls.flat().join(' ')).not.toContain('preview.target@example.com');
        } finally {
            errorSpy.mockRestore();
        }
    });

    it('rejects unauthenticated users', async () => {
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        vi.mocked(createSupabaseServerClient).mockReturnValue(createUnauthenticatedMockClient() as any);

        const { GET } = await import('../../src/pages/api/email/send-test');
        const response = await GET(getContext('welcome') as any);

        expect(response.status).toBe(401);
    });

    it('rejects non-admin users', async () => {
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        vi.mocked(createSupabaseServerClient).mockReturnValue(createRoleClient('student') as any);

        const { GET } = await import('../../src/pages/api/email/send-test');
        const response = await GET(getContext('welcome') as any);

        expect(response.status).toBe(403);
    });

    it('rejects invalid preview types and invalid send payloads', async () => {
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        vi.mocked(createSupabaseServerClient).mockReturnValue(createRoleClient('admin') as any);

        const { GET, POST } = await import('../../src/pages/api/email/send-test');
        const invalidGet = await GET(getContext('unknown') as any);
        const invalidPost = await POST(postContext({ type: 'welcome', email: 'not-an-email' }) as any);

        expect(invalidGet.status).toBe(400);
        expect(invalidPost.status).toBe(400);
    });
});
