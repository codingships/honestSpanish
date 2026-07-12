import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    PORTAL_CANCEL_ACTION_NAMES,
    PORTAL_CONTINUE_ACTION_NAMES,
    sanitizePortalSmokeText,
    STAGING_PORTAL_SMOKE,
    STAGING_PORTAL_SMOKE_APPROVAL,
    STAGING_PORTAL_SMOKE_APPROVAL_ENV,
    validateCancellation,
    validateOwnedStripeResource,
    validatePortalConfig,
    validateSafeReturnUrl,
    validateStagingPortalSmokeEnv,
    validateTrialSubscription,
} from '../../scripts/launch/staging-customer-portal-smoke-shared';

const rootDir = process.cwd();

describe('staging Customer Portal smoke runner', () => {
    it('pins the exact staging web, Supabase and Stripe test targets', () => {
        expect(STAGING_PORTAL_SMOKE).toMatchObject({
            supabaseProjectRef: 'mzjyvmlxfpzdfdjzxxyj',
            stripeAccountId: 'acct_1TruqOC22M3erP0j',
            webOrigin: 'https://espanolhonesto-staging.alindev95.workers.dev',
            trialDays: 14,
        });
        expect(STAGING_PORTAL_SMOKE_APPROVAL_ENV).toBe('STAGING_PORTAL_SMOKE_APPROVAL');
        expect(STAGING_PORTAL_SMOKE_APPROVAL).toContain('no autorizo webhooks sinteticos');
        expect(STAGING_PORTAL_SMOKE_APPROVAL).toContain('no autorizo webhooks sinteticos, Resend ni otros emails');
    });

    it('accepts only a fail-closed exact staging environment using test Stripe keys', () => {
        expect(validateStagingPortalSmokeEnv(validEnv()).valid).toBe(true);

        for (const patch of [
            { PUBLIC_APP_ENV: 'production' },
            { PUBLIC_SITE_URL: 'https://example.invalid' },
            { PUBLIC_SUPABASE_URL: 'https://wrong.supabase.co' },
            { SUPABASE_EXPECTED_PROJECT_REF: 'wrong' },
            { STRIPE_EXPECTED_ACCOUNT_ID: 'acct_wrong' },
            { STRIPE_SECRET_KEY: ['sk', '_live_', 'placeholder'].join('') },
            { PUBLIC_STRIPE_PUBLISHABLE_KEY: ['pk', '_live_', 'placeholder'].join('') },
            { STRIPE_PORTAL_CONFIGURATION_ID: 'wrong' },
            { CHECKOUT_ENABLED: 'true' },
            { CHECKOUT_ENABLED_OVERRIDE: 'true' },
            { TEST_STUDENT_EMAIL: 'student@example.com' },
            { TEST_STUDENT_PASSWORD: 'short' },
        ]) {
            expect(validateStagingPortalSmokeEnv({ ...validEnv(), ...patch }).valid).toBe(false);
        }
    });

    it('requires the pinned Portal config to cancel only at period end with plan changes disabled', () => {
        const configuration = portalConfig();
        expect(validatePortalConfig(configuration, configuration.id).valid).toBe(true);

        for (const patch of [
            { active: false },
            { livemode: true },
            { subscriptionCancelEnabled: false },
            { subscriptionCancelMode: 'immediately' },
            { subscriptionCancelProration: 'create_prorations' },
            { subscriptionUpdateEnabled: true },
            { defaultReturnUrl: 'https://wrong.invalid/account' },
        ]) {
            expect(validatePortalConfig({ ...configuration, ...patch }, configuration.id).valid).toBe(false);
        }
    });

    it('accepts only a zero-money trial with no payment method, PaymentIntent or charge', () => {
        const now = 2_000_000_000;
        const snapshot = trialSnapshot(now);
        expect(validateTrialSubscription(snapshot, now).valid).toBe(true);

        for (const patch of [
            { status: 'active' },
            { livemode: true },
            { customerId: 'cus_wrong' },
            { itemCount: 2 },
            { priceId: 'price_wrong' },
            { trialEnd: now + 86_400 },
            { cancelAtPeriodEnd: true },
            { missingPaymentMethodBehavior: 'create_invoice' },
            { paymentMethodCount: 1 },
            { paymentIntentCount: 1 },
            { chargeCount: 1 },
            { invoiceAmountDue: 1 },
        ]) {
            expect(validateTrialSubscription({ ...snapshot, ...patch }, now).valid).toBe(false);
        }
    });

    it('recognizes classic cancel_at_period_end and an exact period-end cancel_at', () => {
        expect(validateCancellation({
            status: 'trialing',
            periodEnd: 2_100_000_000,
            trialEnd: 2_100_000_000,
            cancelAtPeriodEnd: true,
            cancelAt: null,
        }).valid).toBe(true);
        expect(validateCancellation({
            status: 'trialing',
            periodEnd: 2_100_000_000,
            trialEnd: 2_100_000_000,
            cancelAtPeriodEnd: false,
            cancelAt: 2_100_000_000,
        }).valid).toBe(true);
        expect(validateCancellation({
            status: 'trialing',
            periodEnd: 2_100_000_000,
            trialEnd: 2_100_000_000,
            cancelAtPeriodEnd: false,
            cancelAt: null,
        }).valid).toBe(false);
    });

    it('ownership-gates cleanup and accepts only the exact staging account return URL', () => {
        expect(validateOwnedStripeResource({
            source: STAGING_PORTAL_SMOKE.source,
            runId: 'run-1',
            expectedRunId: 'run-1',
            livemode: false,
        }).valid).toBe(true);
        expect(validateOwnedStripeResource({
            source: STAGING_PORTAL_SMOKE.source,
            runId: 'run-2',
            expectedRunId: 'run-1',
            livemode: false,
        }).valid).toBe(false);
        expect(validateOwnedStripeResource({
            source: STAGING_PORTAL_SMOKE.source,
            runId: 'run-1',
            expectedRunId: 'run-1',
            livemode: true,
        }).valid).toBe(false);

        expect(validateSafeReturnUrl(`${STAGING_PORTAL_SMOKE.webOrigin}/es/campus/account`, 'es').valid).toBe(true);
        expect(validateSafeReturnUrl(`${STAGING_PORTAL_SMOKE.webOrigin}/en/campus/account`, 'en').valid).toBe(true);
        expect(validateSafeReturnUrl(`${STAGING_PORTAL_SMOKE.webOrigin}/es/campus/account?next=bad`, 'es').valid).toBe(false);
        expect(validateSafeReturnUrl('https://wrong.invalid/es/campus/account', 'es').valid).toBe(false);
    });

    it('has robust ES/EN cancellation and continuation selectors', () => {
        const matches = (value: string, patterns: readonly RegExp[]) => patterns.some((pattern) => pattern.test(value));
        expect(matches('Cancel subscription', PORTAL_CANCEL_ACTION_NAMES)).toBe(true);
        expect(matches('Cancel plan', PORTAL_CANCEL_ACTION_NAMES)).toBe(true);
        expect(matches('Cancelar la suscripción', PORTAL_CANCEL_ACTION_NAMES)).toBe(true);
        expect(matches('Cancelar el plan', PORTAL_CANCEL_ACTION_NAMES)).toBe(true);
        expect(matches('Continue to cancel', PORTAL_CANCEL_ACTION_NAMES)).toBe(true);
        expect(matches('Continuar con la cancelación', PORTAL_CANCEL_ACTION_NAMES)).toBe(true);
        expect(matches('Continue', PORTAL_CONTINUE_ACTION_NAMES)).toBe(true);
        expect(matches('Continuar', PORTAL_CONTINUE_ACTION_NAMES)).toBe(true);
    });

    it('redacts emails, keys, tokens and Stripe Portal session URLs', () => {
        const unsafe = [
            ['student', '@', 'testing.invalid'].join(''),
            ['sk', '_test_', 'placeholder-secret-material'].join(''),
            ['https://billing.stripe.com/p/session/', 'test_private_path'].join(''),
            ['authorization', '=', 'private-value'].join(''),
        ].join(' ');
        const safe = sanitizePortalSmokeText(unsafe);
        expect(safe).not.toContain('student@');
        expect(safe).not.toContain('placeholder-secret-material');
        expect(safe).not.toContain('test_private_path');
        expect(safe).not.toContain('private-value');
        expect(safe).toContain('[redacted');
    });

    it('keeps approval/preflight before writes and cleanup in finally with no synthetic/email/Checkout/browser artifacts', () => {
        const runner = readFileSync(
            path.join(rootDir, 'scripts/launch/staging-customer-portal-smoke-runner.ts'),
            'utf8',
        );
        const approval = runner.indexOf("(mode === 'execute-approved' || mode === 'cleanup-only') && !approvalMatched");
        const preflight = runner.indexOf('const preflight = await runReadOnlyPreflight', approval);
        const execution = runner.indexOf('const execution = await runApprovedPortalSmoke', preflight);
        const finallyBlock = runner.indexOf('} finally {', execution);
        const cleanup = runner.indexOf('await cleanupOwnedResources', finallyBlock);

        expect(approval).toBeGreaterThan(-1);
        expect(preflight).toBeGreaterThan(approval);
        expect(execution).toBeGreaterThan(preflight);
        expect(finallyBlock).toBeGreaterThan(execution);
        expect(cleanup).toBeGreaterThan(finallyBlock);
        expect(runner).toContain("chromium.launch({ headless: false");
        expect(runner).toContain("page.locator('#manage-sub-btn')");
        expect(runner).not.toContain("page.locator('#manage-stripe-btn')");
        expect(runner).toContain("url.hostname === 'billing.stripe.com'");
        expect(runner).toContain('portalUrlStored: false');
        expect(runner).toContain('screenshotsStored: false');
        expect(runner).not.toContain('stripe.testHelpers');
        expect(runner).not.toContain('stripe.checkout.sessions.create');
        expect(runner).not.toContain('/api/stripe-webhook');
        expect(runner).not.toContain('page.screenshot');
        expect(runner).not.toMatch(/resend\.(?:emails\.)?send/iu);

        const packageJson = JSON.parse(readFileSync(path.join(rootDir, 'package.json'), 'utf8')) as {
            scripts?: Record<string, string>;
        };
        expect(packageJson.scripts?.['launch:staging-customer-portal-smoke'])
            .toBe('tsx scripts/launch/staging-customer-portal-smoke-runner.ts');
    });
});

function validEnv(): Record<string, string> {
    return {
        PUBLIC_APP_ENV: 'staging',
        PUBLIC_SITE_URL: STAGING_PORTAL_SMOKE.webOrigin,
        PUBLIC_SUPABASE_URL: `https://${STAGING_PORTAL_SMOKE.supabaseProjectRef}.supabase.co`,
        SUPABASE_EXPECTED_PROJECT_REF: STAGING_PORTAL_SMOKE.supabaseProjectRef,
        PUBLIC_SUPABASE_ANON_KEY: 'placeholder-anon',
        SUPABASE_SERVICE_ROLE_KEY: 'placeholder-service',
        STRIPE_SECRET_KEY: ['sk', '_test_', 'placeholder'].join(''),
        PUBLIC_STRIPE_PUBLISHABLE_KEY: ['pk', '_test_', 'placeholder'].join(''),
        STRIPE_EXPECTED_ACCOUNT_ID: STAGING_PORTAL_SMOKE.stripeAccountId,
        STRIPE_PORTAL_CONFIGURATION_ID: 'bpc_placeholder',
        INTERNAL_JOB_SECRET: 'placeholder-internal',
        CHECKOUT_ENABLED: 'false',
        CHECKOUT_ENABLED_OVERRIDE: 'false',
        TEST_STUDENT_EMAIL: ['student', '@', 'testing.invalid'].join(''),
        TEST_STUDENT_PASSWORD: 'placeholder-password',
    };
}

function portalConfig() {
    return {
        id: 'bpc_placeholder',
        active: true,
        livemode: false,
        defaultReturnUrl: `${STAGING_PORTAL_SMOKE.webOrigin}/es/campus/account`,
        paymentMethodUpdateEnabled: true,
        invoiceHistoryEnabled: true,
        subscriptionCancelEnabled: true,
        subscriptionCancelMode: 'at_period_end',
        subscriptionCancelProration: 'none',
        subscriptionUpdateEnabled: false,
    };
}

function trialSnapshot(now: number) {
    return {
        status: 'trialing',
        livemode: false,
        customerId: 'cus_owned',
        expectedCustomerId: 'cus_owned',
        itemCount: 1,
        priceId: 'price_owned',
        expectedPriceId: 'price_owned',
        periodEnd: now + 14 * 86_400,
        trialEnd: now + 14 * 86_400,
        cancelAtPeriodEnd: false,
        cancelAt: null,
        missingPaymentMethodBehavior: 'cancel',
        paymentMethodCount: 0,
        paymentIntentCount: 0,
        chargeCount: 0,
        invoiceAmountDue: 0,
        invoiceAmountPaid: 0,
        invoiceTotal: 0,
    };
}
