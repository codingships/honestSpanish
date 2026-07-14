import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    ADMIN_EMAIL_PREVIEW_CACHE_CONTROL,
    ADMIN_EMAIL_PREVIEW_CSP,
} from '../../src/lib/security-headers';

const mocks = vi.hoisted(() => ({
    getUser: vi.fn(),
    single: vi.fn(),
}));

vi.mock('../../src/lib/supabase-server', () => ({
    createSupabaseServerClient: vi.fn(() => ({
        auth: { getUser: mocks.getUser },
        from: vi.fn(() => ({
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: mocks.single,
        })),
    })),
}));

function context(query = '') {
    return {
        request: new Request(`https://example.com/api/email/preview-frame${query}`),
    };
}

describe('admin email preview frame endpoint', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getUser.mockResolvedValue({ data: { user: { id: 'admin-1' } }, error: null });
        mocks.single.mockResolvedValue({ data: { role: 'admin' }, error: null });
    });

    it('requires an authenticated admin', async () => {
        mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
        const { GET } = await import('../../src/pages/api/email/preview-frame');

        const response = await GET(context() as any) as Response;

        expect(response.status).toBe(401);
        expect(await response.text()).toContain('Unauthorized');
        expect(mocks.single).not.toHaveBeenCalled();
        expect(response.headers.get('Content-Security-Policy')).toBe(ADMIN_EMAIL_PREVIEW_CSP);
        expect(response.headers.get('X-Frame-Options')).toBe('SAMEORIGIN');
        expect(response.headers.get('Cache-Control')).toBe(ADMIN_EMAIL_PREVIEW_CACHE_CONTROL);
    });

    it('rejects authenticated non-admin users', async () => {
        mocks.single.mockResolvedValue({ data: { role: 'student' }, error: null });
        const { GET } = await import('../../src/pages/api/email/preview-frame');

        const response = await GET(context() as any) as Response;

        expect(response.status).toBe(403);
        expect(await response.text()).toContain('Forbidden');
    });

    it('validates the allowlisted template and locale', async () => {
        const { GET } = await import('../../src/pages/api/email/preview-frame');

        const response = await GET(context('?type=unknown&locale=en') as any) as Response;

        expect(response.status).toBe(400);
        expect(await response.text()).toContain('Invalid type');
    });

    it('returns the isolated, non-cacheable email HTML for an admin', async () => {
        const { GET } = await import('../../src/pages/api/email/preview-frame');

        const response = await GET(context('?type=welcome&locale=es') as any) as Response;
        const body = await response.text();

        expect(response.status).toBe(200);
        expect(response.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
        expect(response.headers.get('Cache-Control')).toBe(ADMIN_EMAIL_PREVIEW_CACHE_CONTROL);
        expect(response.headers.get('Content-Security-Policy')).toBe(ADMIN_EMAIL_PREVIEW_CSP);
        expect(response.headers.get('Cross-Origin-Resource-Policy')).toBe('same-origin');
        expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
        expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
        expect(response.headers.get('X-Frame-Options')).toBe('SAMEORIGIN');
        expect(body).toContain('style=');
        expect(body).toContain('ESPA');
    });
});
