import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    env: {} as Record<string, string | undefined>,
    rpc: vi.fn(),
    send: vi.fn(),
}));

vi.mock('../../src/lib/runtime-env', () => ({
    readRuntimeEnv: vi.fn((key: string) => mocks.env[key]),
}));

vi.mock('../../src/lib/supabase-admin', () => ({
    createSupabaseAdminClient: vi.fn(() => ({ rpc: mocks.rpc })),
}));

vi.mock('../../src/lib/email/client', () => ({
    getEmailFrom: vi.fn(() => 'Academia <hello@example.com>'),
    getResend: vi.fn(() => ({ emails: { send: mocks.send } })),
}));

import {
    deliverEmail,
    deliverIdempotentEmail,
    deliverPreReservedStagingSmokeEmail,
    getEmailDeliveryPolicy,
    PRODUCTION_EMAIL_DAILY_RECIPIENT_LIMIT,
    PRODUCTION_EMAIL_MONTHLY_RECIPIENT_LIMIT,
    STAGING_EMAIL_DAILY_RECIPIENT_LIMIT,
    STAGING_EMAIL_MONTHLY_RECIPIENT_LIMIT,
} from '../../src/lib/email/delivery';

const email = (to: string | string[] = 'student@example.com') => ({
    to,
    subject: 'Test',
    html: '<p>Test</p>',
    source: 'test_source',
});

describe('persistent email recipient budget gate', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        for (const key of Object.keys(mocks.env)) delete mocks.env[key];
        mocks.rpc.mockResolvedValue({ data: [{ daily_used: 1, monthly_used: 1 }], error: null });
        mocks.send.mockResolvedValue({ data: { id: 'email-1' }, error: null });
    });

    it('fails closed when delivery mode is absent', async () => {
        mocks.env.PUBLIC_APP_ENV = 'staging';

        await expect(deliverEmail(email())).resolves.toEqual({
            ok: false,
            reason: 'delivery_disabled',
        });
        expect(mocks.rpc).not.toHaveBeenCalled();
        expect(mocks.send).not.toHaveBeenCalled();
    });

    it('never permits live delivery outside production', async () => {
        Object.assign(mocks.env, {
            PUBLIC_APP_ENV: 'staging',
            EMAIL_DELIVERY_MODE: 'live',
            RESEND_API_KEY: 're_test',
        });

        await expect(deliverEmail(email())).resolves.toEqual({
            ok: false,
            reason: 'invalid_delivery_mode',
        });
        expect(mocks.rpc).not.toHaveBeenCalled();
        expect(mocks.send).not.toHaveBeenCalled();
    });

    it('limits staging delivery to the explicit recipient allowlist', async () => {
        Object.assign(mocks.env, {
            PUBLIC_APP_ENV: 'staging',
            EMAIL_DELIVERY_MODE: 'allowlist',
            EMAIL_RECIPIENT_ALLOWLIST: 'Allowed Person <allowed@example.com>',
            RESEND_API_KEY: 're_test',
        });

        await expect(deliverEmail(email('blocked@example.com'))).resolves.toEqual({
            ok: false,
            reason: 'recipient_not_allowlisted',
        });
        expect(mocks.rpc).not.toHaveBeenCalled();
        expect(mocks.send).not.toHaveBeenCalled();

        await expect(deliverEmail(email('ALLOWED@example.com'))).resolves.toEqual({ ok: true });
        expect(mocks.send).toHaveBeenCalledTimes(1);
    });

    it('allows only Resend delivered sinks as implicit non-human staging recipients', async () => {
        Object.assign(mocks.env, {
            PUBLIC_APP_ENV: 'staging',
            EMAIL_DELIVERY_MODE: 'allowlist',
            RESEND_API_KEY: 're_test',
        });

        await expect(deliverEmail(email('delivered+checkout-v2-student@resend.dev')))
            .resolves.toEqual({ ok: true });
        await expect(deliverEmail(email('bounced+checkout-v2-student@resend.dev')))
            .resolves.toEqual({ ok: false, reason: 'recipient_not_allowlisted' });

        mocks.env.PUBLIC_APP_ENV = 'production';
        await expect(deliverEmail(email('delivered+checkout-v2-student@resend.dev')))
            .resolves.toEqual({ ok: false, reason: 'recipient_not_allowlisted' });
        expect(mocks.send).toHaveBeenCalledTimes(1);
    });

    it('atomically reserves one unit per recipient entry before sending', async () => {
        Object.assign(mocks.env, {
            PUBLIC_APP_ENV: 'staging',
            EMAIL_DELIVERY_MODE: 'allowlist',
            EMAIL_RECIPIENT_ALLOWLIST: 'one@example.com,two@example.com',
            RESEND_API_KEY: 're_test',
        });

        await expect(deliverEmail(email(['one@example.com', 'two@example.com']))).resolves.toEqual({ ok: true });

        expect(mocks.rpc).toHaveBeenCalledWith('reserve_email_recipient_budget', {
            p_budget_scope: 'nonproduction',
            p_recipient_count: 2,
            p_daily_limit: STAGING_EMAIL_DAILY_RECIPIENT_LIMIT,
            p_monthly_limit: STAGING_EMAIL_MONTHLY_RECIPIENT_LIMIT,
            p_source: 'test_source',
        });
        expect(mocks.rpc.mock.invocationCallOrder[0]).toBeLessThan(mocks.send.mock.invocationCallOrder[0]);
    });

    it('uses conservative production defaults and clamps unsafe overrides', () => {
        Object.assign(mocks.env, {
            PUBLIC_APP_ENV: 'production',
            EMAIL_DELIVERY_MODE: 'live',
            EMAIL_DAILY_RECIPIENT_LIMIT: '100',
            EMAIL_MONTHLY_RECIPIENT_LIMIT: '3000',
        });

        const policy = getEmailDeliveryPolicy();
        expect(policy.dailyLimit).toBe(PRODUCTION_EMAIL_DAILY_RECIPIENT_LIMIT);
        expect(policy.monthlyLimit).toBe(PRODUCTION_EMAIL_MONTHLY_RECIPIENT_LIMIT);
        expect(policy.budgetScope).toBe('production');
    });

    it('shares one quota scope across every non-production runtime', () => {
        for (const appEnvironment of ['staging', 'dev', 'preview', undefined]) {
            if (appEnvironment) mocks.env.PUBLIC_APP_ENV = appEnvironment;
            else delete mocks.env.PUBLIC_APP_ENV;
            expect(getEmailDeliveryPolicy().budgetScope).toBe('nonproduction');
        }
    });

    it.each([
        ['email_budget_daily_exceeded', 'budget_daily_exceeded'],
        ['email_budget_monthly_exceeded', 'budget_monthly_exceeded'],
        ['database unavailable', 'budget_unavailable'],
    ] as const)('blocks provider delivery when reservation fails with %s', async (message, reason) => {
        Object.assign(mocks.env, {
            PUBLIC_APP_ENV: 'production',
            EMAIL_DELIVERY_MODE: 'live',
            RESEND_API_KEY: 're_live',
        });
        mocks.rpc.mockResolvedValue({ data: null, error: { message } });

        await expect(deliverEmail(email())).resolves.toEqual({ ok: false, reason });
        expect(mocks.send).not.toHaveBeenCalled();
    });

    it('fails closed when the budget service throws', async () => {
        Object.assign(mocks.env, {
            PUBLIC_APP_ENV: 'production',
            EMAIL_DELIVERY_MODE: 'live',
            RESEND_API_KEY: 're_live',
        });
        mocks.rpc.mockRejectedValue(new Error('network unavailable'));

        await expect(deliverEmail(email())).resolves.toEqual({
            ok: false,
            reason: 'budget_unavailable',
        });
        expect(mocks.send).not.toHaveBeenCalled();
    });

    it('keeps the conservative reservation when the provider rejects the send', async () => {
        Object.assign(mocks.env, {
            PUBLIC_APP_ENV: 'production',
            EMAIL_DELIVERY_MODE: 'live',
            RESEND_API_KEY: 're_live',
        });
        const providerError = { message: 'provider rejected request', statusCode: 422 };
        mocks.send.mockResolvedValue({ data: null, error: providerError });

        await expect(deliverEmail(email())).resolves.toEqual({
            ok: false,
            reason: 'provider_error',
            error: providerError,
        });
        expect(mocks.rpc).toHaveBeenCalledTimes(1);
        expect(mocks.send).toHaveBeenCalledTimes(1);
    });

    it('returns the provider ID and passes the stable idempotency key to Resend', async () => {
        Object.assign(mocks.env, {
            PUBLIC_APP_ENV: 'production',
            EMAIL_DELIVERY_MODE: 'live',
            RESEND_API_KEY: 're_live',
        });
        const idempotencyKey = 'fulfillment/11111111-1111-4111-8111-111111111111/email.welcome.student';

        await expect(deliverIdempotentEmail({
            ...email('STUDENT@example.com'),
            from: 'Academia <hello@example.com>',
            idempotencyKey,
            to: 'STUDENT@example.com',
        })).resolves.toEqual({ ok: true, providerId: 'email-1' });

        expect(mocks.send).toHaveBeenCalledWith({
            from: 'Academia <hello@example.com>',
            html: '<p>Test</p>',
            subject: 'Test',
            to: 'student@example.com',
        }, { idempotencyKey });
    });

    it('classifies a transport exception as unknown provider acceptance', async () => {
        Object.assign(mocks.env, {
            PUBLIC_APP_ENV: 'production',
            EMAIL_DELIVERY_MODE: 'live',
            RESEND_API_KEY: 're_live',
        });
        const transportError = new Error('request timed out');
        mocks.send.mockRejectedValue(transportError);

        await expect(deliverIdempotentEmail({
            ...email(),
            idempotencyKey: 'fulfillment/11111111-1111-4111-8111-111111111111/email.welcome.student',
            to: 'student@example.com',
        })).resolves.toEqual({
            acceptance: 'ambiguous',
            error: transportError,
            ok: false,
            reason: 'provider_error',
        });
    });

    it.each([
        [null, 'ambiguous'],
        [409, 'ambiguous'],
        [503, 'ambiguous'],
        [422, 'not_accepted'],
    ] as const)(
        'classifies a resolved Resend error with status %s as %s',
        async (statusCode, acceptance) => {
            Object.assign(mocks.env, {
                PUBLIC_APP_ENV: 'production',
                EMAIL_DELIVERY_MODE: 'live',
                RESEND_API_KEY: 're_live',
            });
            const providerError = {
                message: statusCode === null
                    ? 'Unable to fetch data. The request could not be resolved.'
                    : 'Provider response',
                name: 'application_error',
                statusCode,
            };
            mocks.send.mockResolvedValue({ data: null, error: providerError });

            await expect(deliverIdempotentEmail({
                ...email(),
                idempotencyKey: 'fulfillment/11111111-1111-4111-8111-111111111111/email.welcome.student',
                to: 'student@example.com',
            })).resolves.toEqual({
                acceptance,
                error: providerError,
                ok: false,
                reason: 'provider_error',
            });
        },
    );

    it('keeps pre-reserved smoke delivery inside the same fail-closed provider gateway', async () => {
        Object.assign(mocks.env, {
            PUBLIC_APP_ENV: 'staging',
            EMAIL_DELIVERY_MODE: 'allowlist',
            EMAIL_RECIPIENT_ALLOWLIST: 'allowed@example.com',
            EMAIL_DAILY_RECIPIENT_LIMIT: '10',
            EMAIL_MONTHLY_RECIPIENT_LIMIT: '100',
            EMAIL_FROM: 'Academia <hello@example.com>',
            RESEND_API_KEY: 're_test',
        });
        const input = {
            from: 'Academia <hello@example.com>',
            html: '<p>Smoke</p>',
            idempotencyKey: 'staging-integration-smoke/email/11111111-1111-4111-8111-111111111111',
            subject: 'Smoke',
            to: 'ALLOWED@example.com',
        };

        await expect(deliverPreReservedStagingSmokeEmail(input)).resolves.toEqual({
            ok: true,
            providerId: 'email-1',
        });
        expect(mocks.rpc).not.toHaveBeenCalled();
        expect(mocks.send).toHaveBeenCalledWith({
            from: input.from,
            html: input.html,
            subject: input.subject,
            to: 'allowed@example.com',
        }, { idempotencyKey: input.idempotencyKey });
    });

    it('rejects a pre-reserved send when any staging invariant is missing', async () => {
        Object.assign(mocks.env, {
            PUBLIC_APP_ENV: 'staging',
            EMAIL_DELIVERY_MODE: 'allowlist',
            EMAIL_RECIPIENT_ALLOWLIST: 'allowed@example.com',
            EMAIL_FROM: 'Academia <hello@example.com>',
            RESEND_API_KEY: 're_test',
        });
        await expect(deliverPreReservedStagingSmokeEmail({
            from: 'Academia <hello@example.com>',
            html: '<p>Smoke</p>',
            idempotencyKey: 'caller-controlled-key',
            subject: 'Smoke',
            to: 'allowed@example.com',
        })).resolves.toEqual({ ok: false, reason: 'policy_invalid' });
        expect(mocks.send).not.toHaveBeenCalled();
    });
});
