import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    adultVerified: vi.fn(),
    createAdmin: vi.fn(),
    createServer: vi.fn(),
    env: new Map<string, string>(),
    issueGrant: vi.fn(),
    syntheticEmail: vi.fn(),
}));

vi.mock('../../src/lib/adult-account', () => ({
    hasVerifiedAdultAccount: mocks.adultVerified,
}));

vi.mock('../../src/lib/supabase-admin', () => ({
    createSupabaseAdminClient: mocks.createAdmin,
}));

vi.mock('../../src/lib/supabase-server', () => ({
    createSupabaseServerClient: mocks.createServer,
}));

vi.mock('../../src/lib/runtime-env', () => ({
    readRuntimeEnv: vi.fn((key: string) => mocks.env.get(key)),
}));

vi.mock('../../src/lib/staging-e2e-checkout', () => ({
    issueStagingE2ECheckoutGrant: mocks.issueGrant,
    isStagingE2ESyntheticEmail: mocks.syntheticEmail,
    STAGING_E2E_CHECKOUT_CONFIRMATION: 'sandbox-journey',
    STAGING_E2E_CHECKOUT_COOKIE: '__Host-hs_staging_e2e_checkout',
    STAGING_E2E_CHECKOUT_MAX_AGE_SECONDS: 10 * 60,
}));

import { DELETE, POST } from '../../src/pages/api/internal/staging-e2e-checkout';

const stagingOrigin = 'https://staging.espanolhonesto.com';
const adminId = '10000000-0000-4000-8000-000000000001';
const studentId = '20000000-0000-4000-8000-000000000002';
const slotPublicId = '30000000-0000-4000-8000-000000000003';
const adminEmail = 'admin@espanolhonesto.test';
const studentEmail = 'delivered+hs-stg-journey-a@resend.dev';
const runId = 'journey-a-20260802';
const grantToken = 'private.payload-and-signature';
const expiresAt = '2026-08-02T10:30:00.000Z';

type Actor = { email: string | null; id: string; role: string };
type Target = {
    adult_confirmed: boolean;
    adult_confirmed_at: string;
    age_policy_version: string;
    email: string | null;
    id: string;
    role: string;
};

function adminClient(actor: Actor, target?: Target) {
    const maybeSingle = vi.fn()
        .mockResolvedValueOnce({ data: actor, error: null });
    if (target) maybeSingle.mockResolvedValueOnce({ data: target, error: null });
    const query = {
        eq: vi.fn(),
        maybeSingle,
        select: vi.fn(),
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    return {
        auth: {
            admin: {
                getUserById: vi.fn().mockResolvedValue({
                    data: {
                        user: {
                            email: target?.email,
                            email_confirmed_at: '2026-08-02T09:00:00.000Z',
                            id: studentId,
                        },
                    },
                    error: null,
                }),
            },
        },
        from: vi.fn().mockReturnValue(query),
    };
}

function requestContext(input: {
    body?: unknown;
    confirmation?: string | null;
    method?: 'DELETE' | 'POST';
    origin?: string | null;
    urlOrigin?: string;
} = {}) {
    const method = input.method ?? 'POST';
    const headers = new Headers();
    if (input.origin !== null) headers.set('Origin', input.origin ?? stagingOrigin);
    if (method === 'POST') {
        headers.set('Content-Type', 'application/json');
        if (input.confirmation !== null) {
            headers.set('X-Staging-E2E-Confirmation', input.confirmation ?? 'sandbox-journey');
        }
    }
    return {
        cookies: { set: vi.fn() },
        locals: {},
        request: new Request(
            `${input.urlOrigin ?? stagingOrigin}/api/internal/staging-e2e-checkout`,
            {
                method,
                headers,
                body: method === 'POST'
                    ? JSON.stringify(input.body ?? { runId, slotPublicId, studentId })
                    : undefined,
            },
        ),
    };
}

function validActor(): Actor {
    return { email: adminEmail, id: adminId, role: 'admin' };
}

function validTarget(email = studentEmail): Target {
    return {
        adult_confirmed: true,
        adult_confirmed_at: '2026-08-02T09:00:00.000Z',
        age_policy_version: 'current-test-policy',
        email,
        id: studentId,
        role: 'student',
    };
}

describe('private staging transactional checkout grant API', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.env = new Map([
            ['PUBLIC_SITE_URL', stagingOrigin],
            ['TEST_ADMIN_EMAIL', adminEmail],
        ]);
        mocks.adultVerified.mockReturnValue(true);
        mocks.syntheticEmail.mockReturnValue(true);
        mocks.issueGrant.mockResolvedValue({ expiresAt, token: grantToken });
        mocks.createServer.mockReturnValue({
            auth: {
                getUser: vi.fn().mockResolvedValue({
                    data: {
                        user: {
                            email: adminEmail,
                            email_confirmed_at: '2026-08-02T08:00:00.000Z',
                            id: adminId,
                        },
                    },
                    error: null,
                }),
            },
        });
        mocks.createAdmin.mockReturnValue(adminClient(validActor(), validTarget()));
    });

    it('issues the cookie for an eligible synthetic student without leaking private grant data', async () => {
        const context = requestContext();
        const response = await POST(context as unknown as Parameters<typeof POST>[0]);

        expect(response.status).toBe(201);
        expect(response.headers.get('Cache-Control')).toBe('private, no-store');
        await expect(response.clone().json()).resolves.toEqual({ expiresAt });
        const responseText = await response.text();
        for (const privateValue of [grantToken, studentId, slotPublicId, runId, studentEmail, adminEmail]) {
            expect(responseText).not.toContain(privateValue);
        }
        expect(mocks.issueGrant).toHaveBeenCalledWith({
            context,
            email: studentEmail,
            runId,
            slotPublicId,
            studentId,
        });
        expect(context.cookies.set).toHaveBeenCalledWith(
            '__Host-hs_staging_e2e_checkout',
            grantToken,
            {
                httpOnly: true,
                maxAge: 10 * 60,
                path: '/',
                sameSite: 'strict',
                secure: true,
            },
        );
    });

    it('deletes the private grant cookie without requiring an authenticated actor', async () => {
        const context = requestContext({ method: 'DELETE' });
        const response = await DELETE(context as unknown as Parameters<typeof DELETE>[0]);

        expect(response.status).toBe(204);
        expect(await response.text()).toBe('');
        expect(context.cookies.set).toHaveBeenCalledWith(
            '__Host-hs_staging_e2e_checkout',
            '',
            {
                httpOnly: true,
                maxAge: 0,
                path: '/',
                sameSite: 'strict',
                secure: true,
            },
        );
        expect(mocks.createServer).not.toHaveBeenCalled();
        expect(mocks.issueGrant).not.toHaveBeenCalled();
    });

    it('hides the endpoint for a non-canonical request origin before authentication', async () => {
        const context = requestContext({ origin: 'https://evil.example' });
        const response = await POST(context as unknown as Parameters<typeof POST>[0]);

        expect(response.status).toBe(404);
        await expect(response.json()).resolves.toEqual({ error: 'Not found' });
        expect(mocks.createServer).not.toHaveBeenCalled();
        expect(mocks.createAdmin).not.toHaveBeenCalled();
        expect(mocks.issueGrant).not.toHaveBeenCalled();
    });

    it('hides the endpoint when Origin is absent', async () => {
        const response = await POST(requestContext({ origin: null }) as unknown as Parameters<typeof POST>[0]);

        expect(response.status).toBe(404);
        expect(mocks.createServer).not.toHaveBeenCalled();
        expect(mocks.issueGrant).not.toHaveBeenCalled();
    });

    it('requires the exact accidental-execution confirmation header', async () => {
        const response = await POST(requestContext({ confirmation: 'wrong' }) as unknown as Parameters<typeof POST>[0]);

        expect(response.status).toBe(403);
        expect(mocks.createServer).not.toHaveBeenCalled();
        expect(mocks.issueGrant).not.toHaveBeenCalled();
    });

    it('rejects an authenticated actor who is not the exact staging test admin', async () => {
        mocks.createAdmin.mockReturnValue(adminClient({
            email: adminEmail,
            id: adminId,
            role: 'teacher',
        }));
        const response = await POST(requestContext() as unknown as Parameters<typeof POST>[0]);

        expect(response.status).toBe(403);
        await expect(response.json()).resolves.toEqual({ error: 'Forbidden' });
        expect(mocks.syntheticEmail).not.toHaveBeenCalled();
        expect(mocks.issueGrant).not.toHaveBeenCalled();
    });

    it('rejects a real student recipient before issuing any grant', async () => {
        const realEmail = 'real-student@example.com';
        mocks.syntheticEmail.mockReturnValue(false);
        mocks.createAdmin.mockReturnValue(adminClient(validActor(), validTarget(realEmail)));
        const response = await POST(requestContext() as unknown as Parameters<typeof POST>[0]);

        expect(response.status).toBe(409);
        await expect(response.json()).resolves.toEqual({ error: 'Synthetic student is not eligible' });
        expect(mocks.syntheticEmail).toHaveBeenCalledWith(realEmail);
        expect(mocks.issueGrant).not.toHaveBeenCalled();
    });
});
