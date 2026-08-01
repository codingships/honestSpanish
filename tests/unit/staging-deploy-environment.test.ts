import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
    STAGING_DEPLOY_TARGET,
    validateStagingDeployEnvironment,
    verifyStagingDeployProviders,
} from '../../scripts/ci/verify-staging-deploy-environment';

const validEnv = {
    PUBLIC_SUPABASE_URL: STAGING_DEPLOY_TARGET.supabaseUrl,
    PUBLIC_SUPABASE_ANON_KEY: 'eyJ_valid_staging_anon_key_abcdefghijklmnopqrstuvwxyz',
    PUBLIC_STRIPE_PUBLISHABLE_KEY: 'pk_test_valid_staging_publishable_key',
    STRIPE_SECRET_KEY: 'sk_test_valid_staging_secret_key',
    STRIPE_WEBHOOK_SECRET: 'whsec_valid_staging_webhook_secret',
    PUBLIC_SITE_URL: STAGING_DEPLOY_TARGET.siteUrl,
    PUBLIC_TURNSTILE_SITE_KEY: STAGING_DEPLOY_TARGET.turnstileSiteKey,
} satisfies NodeJS.ProcessEnv;

describe('manual staging deploy environment boundary', () => {
    it('accepts only the canonical public staging targets and test-mode key shapes', () => {
        expect(validateStagingDeployEnvironment(validEnv)).toEqual([]);
        expect(validateStagingDeployEnvironment({
            ...validEnv,
            PUBLIC_SUPABASE_URL: 'https://vkkahxsybhbutszerawz.supabase.co',
            STRIPE_SECRET_KEY: 'sk_live_not_allowed_in_staging',
            PUBLIC_STRIPE_PUBLISHABLE_KEY: 'pk_live_not_allowed_in_staging',
        })).toEqual(expect.arrayContaining([
            expect.stringContaining('PUBLIC_SUPABASE_URL must equal'),
            expect.stringContaining('STRIPE_SECRET_KEY'),
            expect.stringContaining('PUBLIC_STRIPE_PUBLISHABLE_KEY'),
        ]));
    });

    it('binds read-only Supabase and Stripe checks to the exact staging identities', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(new Response('{}', { status: 200 }))
            .mockResolvedValueOnce(new Response(JSON.stringify({
                id: STAGING_DEPLOY_TARGET.stripeAccountId,
                country: STAGING_DEPLOY_TARGET.stripeCountry,
                default_currency: STAGING_DEPLOY_TARGET.stripeCurrency,
            }), { status: 200, headers: { 'content-type': 'application/json' } }));

        await expect(verifyStagingDeployProviders(validEnv, fetchMock)).resolves.toEqual({
            supabaseProjectRef: STAGING_DEPLOY_TARGET.supabaseProjectRef,
            stripeAccountId: STAGING_DEPLOY_TARGET.stripeAccountId,
            stripeCountry: STAGING_DEPLOY_TARGET.stripeCountry,
            stripeCurrency: STAGING_DEPLOY_TARGET.stripeCurrency,
        });
        expect(fetchMock).toHaveBeenNthCalledWith(
            1,
            `${STAGING_DEPLOY_TARGET.supabaseUrl}/auth/v1/settings`,
            expect.objectContaining({ method: 'GET' }),
        );
        expect(fetchMock).toHaveBeenNthCalledWith(
            2,
            'https://api.stripe.com/v1/account',
            expect.objectContaining({ method: 'GET' }),
        );
    });

    it('rejects a different Stripe account even when all key prefixes look valid', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(new Response('{}', { status: 200 }))
            .mockResolvedValueOnce(new Response(JSON.stringify({
                id: 'acct_wrong',
                country: 'US',
                default_currency: 'usd',
            }), { status: 200, headers: { 'content-type': 'application/json' } }));

        await expect(verifyStagingDeployProviders(validEnv, fetchMock)).rejects.toThrow(
            'exact Sandbox account, country and currency',
        );
    });

    it('keeps private runtime credentials out of the build process', () => {
        const workflow = readFileSync('.github/workflows/deploy-staging.yml', 'utf8');
        const verifyStep = workflow.slice(
            workflow.indexOf('      - name: Verify exact staging provider identities'),
            workflow.indexOf('      - name: Build exact staging package'),
        );
        const buildStep = workflow.slice(
            workflow.indexOf('      - name: Build exact staging package'),
            workflow.indexOf('      - name: Validate staging Fulfillment package'),
        );

        expect(verifyStep).toContain('scripts/ci/verify-staging-deploy-environment.ts');
        expect(verifyStep).toContain('STRIPE_SECRET_KEY: ${{ secrets.STRIPE_SECRET_KEY }}');
        for (const secretName of [
            'SUPABASE_SERVICE_ROLE_KEY',
            'STRIPE_SECRET_KEY',
            'STRIPE_WEBHOOK_SECRET',
            'TURNSTILE_SECRET_KEY',
            'CHECKOUT_HOLD_FINGERPRINT_SECRET',
            'CRON_SECRET',
            'INTERNAL_JOB_SECRET',
        ]) {
            expect(buildStep).not.toContain(`${secretName}: \${{ secrets.${secretName} }}`);
        }
        expect(buildStep).toContain('SUPABASE_SERVICE_ROLE_KEY: "build-only-placeholder-service-role"');
        expect(buildStep).toContain('STRIPE_SECRET_KEY: "sk_test_build_only_placeholder"');
    });
});
