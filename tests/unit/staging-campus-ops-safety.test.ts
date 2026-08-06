import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    STAGING_CAMPUS_OPS_CONFIRMATION,
    STAGING_CAMPUS_OPS_IDENTITY,
    parseStagingCampusOpsArgs,
    safeStagingCampusOpsSummary,
    validateStagingCampusOpsGate,
} from '../../scripts/smoke/staging-campus-ops-safety';

const workspaceRoot = path.resolve('staging-campus-ops-fixture');
const envFile = path.resolve(workspaceRoot, '.env.staging');

function validEnv(): Record<string, string> {
    return {
        CHECKOUT_ENABLED: 'true',
        CHECKOUT_ENABLED_OVERRIDE: 'true',
        FULFILLMENT_WORKER_URL: STAGING_CAMPUS_OPS_IDENTITY.fulfillmentOrigin,
        PUBLIC_APP_ENV: 'staging',
        PUBLIC_SITE_URL: STAGING_CAMPUS_OPS_IDENTITY.webOrigin,
        PUBLIC_STRIPE_PUBLISHABLE_KEY: 'pk_test_public-never-log',
        PUBLIC_SUPABASE_ANON_KEY: 'anon-never-log',
        PUBLIC_SUPABASE_URL: `https://${STAGING_CAMPUS_OPS_IDENTITY.supabaseProjectRef}.supabase.co`,
        STRIPE_EXPECTED_ACCOUNT_ID: STAGING_CAMPUS_OPS_IDENTITY.stripeAccountId,
        STRIPE_SECRET_KEY: 'sk_test_private-never-log',
        STRIPE_WEBHOOK_SECRET: 'whsec_private-never-log',
        SUPABASE_EXPECTED_PROJECT_REF: STAGING_CAMPUS_OPS_IDENTITY.supabaseProjectRef,
        SUPABASE_SERVICE_ROLE_KEY: 'service-role-never-log',
        TEST_ADMIN_EMAIL: 'admin@example.test',
        TEST_ADMIN_PASSWORD: 'admin-password-never-log',
        TEST_TEACHER_EMAIL: 'teacher@example.test',
        TEST_TEACHER_PASSWORD: 'teacher-password-never-log',
        SUPABASE_DB_URL: `postgresql://postgres@db.${STAGING_CAMPUS_OPS_IDENTITY.supabaseProjectRef}.supabase.co:5432/postgres`,
    };
}

const webConfig = `
[env.staging]
name = "${STAGING_CAMPUS_OPS_IDENTITY.webWorker}"
[[env.staging.services]]
service = "${STAGING_CAMPUS_OPS_IDENTITY.fulfillmentWorker}"
`;
const fulfillmentConfig = `
[env.staging]
name = "${STAGING_CAMPUS_OPS_IDENTITY.fulfillmentWorker}"
`;

describe('staging campus-ops safety', () => {
    it('parses preflight by default and requires confirmation for execute', () => {
        expect(parseStagingCampusOpsArgs([])).toEqual({
            envFile: '.env.staging',
            mode: 'preflight',
        });
        expect(() => parseStagingCampusOpsArgs(['--execute'])).toThrow('--confirmation=');
        expect(parseStagingCampusOpsArgs([
            '--execute',
            '--confirmation',
            STAGING_CAMPUS_OPS_CONFIRMATION,
            '--reuse-subscription',
            'b8e39ea8-3b9a-4534-8b54-6f426b66ba2b',
        ])).toEqual({
            confirmation: STAGING_CAMPUS_OPS_CONFIRMATION,
            envFile: '.env.staging',
            mode: 'execute',
            reuseSubscriptionId: 'b8e39ea8-3b9a-4534-8b54-6f426b66ba2b',
        });
    });

    it('validates the approved staging gate without leaking secrets in the summary', () => {
        const gate = validateStagingCampusOpsGate({
            args: parseStagingCampusOpsArgs([]),
            env: validEnv(),
            fulfillmentConfig,
            repositoryRemote: STAGING_CAMPUS_OPS_IDENTITY.repositoryRemote,
            resolvedEnvFile: envFile,
            webConfig,
            workspaceRoot,
        });
        expect(gate.mode).toBe('preflight');
        const summary = safeStagingCampusOpsSummary(gate).join('\n');
        expect(summary).toContain('campus_ops=b03');
        expect(summary).toContain('production=false');
        expect(summary).not.toContain('service-role-never-log');
        expect(summary).not.toContain('teacher-password-never-log');
    });

    it('rejects production-like targets', () => {
        expect(() => validateStagingCampusOpsGate({
            args: parseStagingCampusOpsArgs([]),
            env: { ...validEnv(), PUBLIC_APP_ENV: 'production' },
            fulfillmentConfig,
            repositoryRemote: STAGING_CAMPUS_OPS_IDENTITY.repositoryRemote,
            resolvedEnvFile: envFile,
            webConfig,
            workspaceRoot,
        })).toThrow('PUBLIC_APP_ENV');
    });
});
