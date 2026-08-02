import { beforeEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({
    values: new Map<string, string>(),
}));

vi.mock('../../src/lib/runtime-env', () => ({
    readRuntimeEnv: vi.fn((key: string) => runtime.values.get(key)),
}));

const context = { locals: {} } as never;
const studentId = '10000000-0000-4000-8000-000000000001';
const slotPublicId = '20000000-0000-4000-8000-000000000002';
const email = 'delivered+hs-stg-journey-a@resend.dev';
const nowMs = Date.parse('2026-08-02T10:00:00.000Z');

describe('private staging E2E checkout grant', () => {
    beforeEach(() => {
        runtime.values = new Map([
            ['PUBLIC_APP_ENV', 'staging'],
            ['PUBLIC_SITE_URL', 'https://staging.espanolhonesto.com'],
            ['WORKER_IDENTITY', 'espanolhonesto-staging'],
            ['CHECKOUT_ENABLED', 'false'],
            ['CHECKOUT_ENABLED_OVERRIDE', 'false'],
            ['INTERNAL_JOB_SECRET', 'independent-staging-internal-job-secret'],
        ]);
    });

    it('issues a short-lived grant and verifies the exact synthetic student', async () => {
        const { issueStagingE2ECheckoutGrant, verifyStagingE2ECheckoutGrant } = await import(
            '../../src/lib/staging-e2e-checkout'
        );
        const issued = await issueStagingE2ECheckoutGrant({
            context,
            email,
            nowMs,
            runId: 'journey-a-20260802',
            slotPublicId,
            studentId,
        });

        expect(issued?.token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u);
        await expect(verifyStagingE2ECheckoutGrant({
            context,
            nowMs: nowMs + 60_000,
            token: issued?.token,
        })).resolves.toEqual({
            email,
            exp: Math.floor(nowMs / 1_000) + 10 * 60,
            runId: 'journey-a-20260802',
            slotPublicId,
            studentId,
        });
    });

    it('rejects tampering, expiry and a different runtime secret', async () => {
        const { issueStagingE2ECheckoutGrant, verifyStagingE2ECheckoutGrant } = await import(
            '../../src/lib/staging-e2e-checkout'
        );
        const issued = await issueStagingE2ECheckoutGrant({
            context,
            email,
            nowMs,
            runId: 'journey-b-20260802',
            slotPublicId,
            studentId,
        });
        expect(issued).not.toBeNull();

        await expect(verifyStagingE2ECheckoutGrant({
            context,
            nowMs,
            token: `${issued!.token.slice(0, -1)}${issued!.token.endsWith('x') ? 'y' : 'x'}`,
        })).resolves.toBeNull();
        await expect(verifyStagingE2ECheckoutGrant({
            context,
            nowMs: nowMs + 10 * 60_000,
            token: issued!.token,
        })).resolves.toBeNull();

        runtime.values.set('INTERNAL_JOB_SECRET', 'another-staging-internal-job-secret');
        await expect(verifyStagingE2ECheckoutGrant({
            context,
            nowMs,
            token: issued!.token,
        })).resolves.toBeNull();
    });

    it('cannot issue grants in production, with an open global gate or for a real recipient', async () => {
        const { issueStagingE2ECheckoutGrant } = await import('../../src/lib/staging-e2e-checkout');
        const issue = (recipient: string) => issueStagingE2ECheckoutGrant({
            context,
            email: recipient,
            nowMs,
            runId: 'journey-c-20260802',
            slotPublicId,
            studentId,
        });

        await expect(issue('student@espanolhonesto.com')).resolves.toBeNull();
        runtime.values.set('CHECKOUT_ENABLED', 'true');
        await expect(issue(email)).resolves.toBeNull();
        runtime.values.set('CHECKOUT_ENABLED', 'false');
        runtime.values.set('PUBLIC_APP_ENV', 'production');
        await expect(issue(email)).resolves.toBeNull();
    });
});
