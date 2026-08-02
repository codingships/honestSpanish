import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
    STAGING_CHECKOUT_V2_CONFIRMATION,
    STAGING_CHECKOUT_V2_IDENTITY,
    parseStagingCheckoutV2Args,
    safeStagingCheckoutV2Summary,
    stagingBrowserCookies,
    validateStagingCheckoutV2Gate,
} from '../../scripts/smoke/staging-checkout-v2-safety';
import {
    runStagingCheckoutV2,
    type StagingCheckoutV2Journey,
} from '../../scripts/smoke/staging-checkout-v2';

const workspaceRoot = path.resolve('staging-checkout-v2-fixture');
const envFile = path.resolve(workspaceRoot, '.env.staging');
const secretKey = 'sk_test_private-never-log';
const webhookSecret = 'whsec_private-never-log';

function validEnv(): Record<string, string> {
    return {
        CHECKOUT_ENABLED: 'false',
        CHECKOUT_ENABLED_OVERRIDE: 'false',
        FULFILLMENT_WORKER_URL: STAGING_CHECKOUT_V2_IDENTITY.fulfillmentOrigin,
        PUBLIC_APP_ENV: 'staging',
        PUBLIC_SITE_URL: STAGING_CHECKOUT_V2_IDENTITY.webOrigin,
        PUBLIC_STRIPE_PUBLISHABLE_KEY: 'pk_test_public-never-log',
        PUBLIC_SUPABASE_ANON_KEY: 'anon-never-log',
        PUBLIC_SUPABASE_URL: `https://${STAGING_CHECKOUT_V2_IDENTITY.supabaseProjectRef}.supabase.co`,
        STRIPE_EXPECTED_ACCOUNT_ID: STAGING_CHECKOUT_V2_IDENTITY.stripeAccountId,
        STRIPE_SECRET_KEY: secretKey,
        STRIPE_WEBHOOK_SECRET: webhookSecret,
        SUPABASE_EXPECTED_PROJECT_REF: STAGING_CHECKOUT_V2_IDENTITY.supabaseProjectRef,
        SUPABASE_SERVICE_ROLE_KEY: 'service-role-never-log',
        TEST_ADMIN_EMAIL: 'admin@example.test',
        TEST_ADMIN_PASSWORD: 'admin-password-never-log',
        TEST_TEACHER_EMAIL: 'teacher@example.test',
    };
}

const webConfig = `
[env.staging]
name = "${STAGING_CHECKOUT_V2_IDENTITY.webWorker}"
[[env.staging.services]]
service = "${STAGING_CHECKOUT_V2_IDENTITY.fulfillmentWorker}"
`;
const fulfillmentConfig = `
[env.staging]
name = "${STAGING_CHECKOUT_V2_IDENTITY.fulfillmentWorker}"
[[env.staging.queues.producers]]
queue = "${STAGING_CHECKOUT_V2_IDENTITY.queue}"
[[env.staging.queues.consumers]]
queue = "${STAGING_CHECKOUT_V2_IDENTITY.queue}"
dead_letter_queue = "${STAGING_CHECKOUT_V2_IDENTITY.deadLetterQueue}"
`;

function validate(overrides: Partial<Parameters<typeof validateStagingCheckoutV2Gate>[0]> = {}) {
    return validateStagingCheckoutV2Gate({
        args: parseStagingCheckoutV2Args([]),
        env: validEnv(),
        fulfillmentConfig,
        repositoryRemote: STAGING_CHECKOUT_V2_IDENTITY.repositoryRemote,
        resolvedEnvFile: envFile,
        webConfig,
        workspaceRoot,
        ...overrides,
    });
}

function runnerFiles(): Map<string, string> {
    return new Map([
        [envFile, Object.entries(validEnv()).map(([key, value]) => `${key}=${value}`).join('\n')],
        [path.resolve(workspaceRoot, 'wrangler.toml'), webConfig],
        [path.resolve(workspaceRoot, 'workers/fulfillment/wrangler.toml'), fulfillmentConfig],
    ]);
}

function runnerDependencies(journey: StagingCheckoutV2Journey, logs: string[]) {
    const files = runnerFiles();
    return {
        envFile,
        journey,
        log: (line: string) => logs.push(line),
        readText: (file: string) => {
            const value = files.get(file);
            if (value === undefined) throw new Error(`Unexpected fixture path: ${file}`);
            return value;
        },
        repositoryRemote: () => STAGING_CHECKOUT_V2_IDENTITY.repositoryRemote,
        workspaceRoot,
    };
}

describe('staging Checkout V2 runner safety', () => {
    it('defaults to read-only preflight and requires the exact execution confirmation', () => {
        expect(parseStagingCheckoutV2Args([])).toEqual({ envFile: '.env.staging', mode: 'preflight' });
        expect(() => parseStagingCheckoutV2Args(['--execute'])).toThrow('requires --confirmation');
        expect(() => parseStagingCheckoutV2Args([
            '--execute', '--confirmation', 'writes-ok:wrong-target',
        ])).toThrow('requires --confirmation');
        expect(parseStagingCheckoutV2Args([
            '--execute', '--confirmation', STAGING_CHECKOUT_V2_CONFIRMATION,
        ])).toEqual({
            confirmation: STAGING_CHECKOUT_V2_CONFIRMATION,
            envFile: '.env.staging',
            mode: 'execute',
        });
        expect(() => parseStagingCheckoutV2Args(['--production'])).toThrow('production, live, DNS');
    });

    it('validates exact staging identities without requiring a local Cloudflare account id', () => {
        const gate = validate();
        expect(gate.identity).toEqual(expect.objectContaining({
            cloudflareAccountId: 'd1a22bcf6477ff2ff31d2bfb83084e44',
            repository: 'codingships/honestSpanish',
            stripeAccountId: 'acct_1TruqOC22M3erP0j',
            stripeLivemode: false,
            supabaseProjectRef: 'mzjyvmlxfpzdfdjzxxyj',
        }));
        expect(validEnv()).not.toHaveProperty('CLOUDFLARE_ACCOUNT_ID');
    });

    it('rejects repository, Supabase, Stripe and queue target drift', () => {
        expect(() => validate({ repositoryRemote: 'https://github.com/other/repository.git' }))
            .toThrow('codingships/honestSpanish');
        expect(() => validate({
            env: { ...validEnv(), PUBLIC_SUPABASE_URL: 'https://wrong.supabase.co' },
        })).toThrow('PUBLIC_SUPABASE_URL');
        expect(() => validate({ env: { ...validEnv(), STRIPE_SECRET_KEY: 'sk_live_forbidden' } }))
            .toThrow('test-mode');
        expect(() => validate({
            fulfillmentConfig: fulfillmentConfig.replace(
                STAGING_CHECKOUT_V2_IDENTITY.deadLetterQueue,
                'production-dlq',
            ),
        })).toThrow('DLQ');
    });

    it('keeps global checkout closed and refuses production or live-shaped runtime', () => {
        expect(() => validate({ env: { ...validEnv(), CHECKOUT_ENABLED: 'true' } }))
            .toThrow('CHECKOUT_ENABLED');
        expect(() => validate({ env: { ...validEnv(), PUBLIC_APP_ENV: 'production' } }))
            .toThrow('PUBLIC_APP_ENV');
        expect(() => validate({ env: { ...validEnv(), PUBLIC_SITE_URL: 'https://espanolhonesto.com' } }))
            .toThrow('PUBLIC_SITE_URL');
        expect(() => validate({
            env: { ...validEnv(), PUBLIC_STRIPE_PUBLISHABLE_KEY: 'pk_live_forbidden' },
        })).toThrow('test-mode');
    });

    it('runs real preflight abstraction read-only and never logs secrets', async () => {
        const logs: string[] = [];
        const journey: StagingCheckoutV2Journey = {
            preflight: vi.fn(async (_env, log) => log('[test] real-preflight=ok')),
            execute: vi.fn(async () => undefined),
            cleanup: vi.fn(async () => undefined),
        };
        const result = await runStagingCheckoutV2([], runnerDependencies(journey, logs));
        expect(result).toBeNull();
        expect(journey.preflight).toHaveBeenCalledOnce();
        expect(journey.execute).not.toHaveBeenCalled();
        expect(journey.cleanup).not.toHaveBeenCalled();
        const output = logs.join('\n');
        expect(output).toContain('external_writes=none');
        expect(output).toContain('result=ok');
        expect(output).not.toContain(secretKey);
        expect(output).not.toContain(webhookSecret);
    });

    it('always runs idempotent cleanup after execution success or failure', async () => {
        const successful: StagingCheckoutV2Journey = {
            preflight: vi.fn(async () => undefined),
            execute: vi.fn(async (_env, state) => { state.checkoutSessionId = 'cs_test_exact'; }),
            cleanup: vi.fn(async () => undefined),
        };
        const successState = await runStagingCheckoutV2([
            '--execute', '--confirmation', STAGING_CHECKOUT_V2_CONFIRMATION,
        ], runnerDependencies(successful, []));
        expect(successState?.checkoutSessionId).toBe('cs_test_exact');
        expect(successful.cleanup).toHaveBeenCalledOnce();

        const failure = new Error('synthetic purchase failed');
        const failing: StagingCheckoutV2Journey = {
            preflight: vi.fn(async () => undefined),
            execute: vi.fn(async () => { throw failure; }),
            cleanup: vi.fn(async () => undefined),
        };
        await expect(runStagingCheckoutV2([
            '--execute', '--confirmation', STAGING_CHECKOUT_V2_CONFIRMATION,
        ], runnerDependencies(failing, []))).rejects.toBe(failure);
        expect(failing.cleanup).toHaveBeenCalledOnce();
    });

    it('marks execute summaries as staging-only writes', () => {
        const gate = validate({
            args: parseStagingCheckoutV2Args([
                '--execute', '--confirmation', STAGING_CHECKOUT_V2_CONFIRMATION,
            ]),
        });
        expect(safeStagingCheckoutV2Summary(gate)).toContain(
            'external_writes=staging-supabase,stripe-sandbox,staging-web',
        );
    });

    it('restores the synthetic student session only on the exact staging origin', () => {
        expect(stagingBrowserCookies('sb-auth-token.0=first==; sb-auth-token.1=second=')).toEqual([
            {
                name: 'sb-auth-token.0',
                value: 'first==',
                url: STAGING_CHECKOUT_V2_IDENTITY.webOrigin,
            },
            {
                name: 'sb-auth-token.1',
                value: 'second=',
                url: STAGING_CHECKOUT_V2_IDENTITY.webOrigin,
            },
        ]);
        expect(() => stagingBrowserCookies('malformed')).toThrow('malformed browser cookie');
        expect(() => stagingBrowserCookies('same=one; same=two')).toThrow('duplicate browser cookies');
    });
});
