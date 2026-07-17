import path from 'node:path';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
    assertCalendarCleanupTarget,
    assertDriveCleanupTarget,
    parseRunnerArgs,
    STAGING_FULFILLMENT_HOST,
    STAGING_SITE_HOST,
    STAGING_SUPABASE_REF,
    validateStagingGates,
} from '../../scripts/smoke/staging-integrations-safety';

const workspaceRoot = process.cwd();
const runnerSource = readFileSync(path.join(workspaceRoot, 'scripts/smoke/staging-integrations.ts'), 'utf8');
const expectedVersionArgs = [
    '--expected-web-version-id', '11111111-1111-4111-8111-111111111111',
    '--expected-fulfillment-version-id', '22222222-2222-4222-8222-222222222222',
];

function approvedArgs(argv: string[] = []) {
    return parseRunnerArgs([...argv, ...expectedVersionArgs]);
}

function stagingEnv(): Record<string, string> {
    return {
        CHECKOUT_ENABLED: 'false',
        CHECKOUT_ENABLED_OVERRIDE: 'false',
        EMAIL_DAILY_RECIPIENT_LIMIT: '10',
        EMAIL_DELIVERY_MODE: 'allowlist',
        EMAIL_MONTHLY_RECIPIENT_LIMIT: '100',
        EMAIL_RECIPIENT_ALLOWLIST: 'admin@example.com,student@example.com,teacher@example.com',
        FULFILLMENT_WORKER_URL: `https://${STAGING_FULFILLMENT_HOST}`,
        GOOGLE_ADMIN_EMAIL: 'owner@example.com',
        GOOGLE_DRIVE_ROOT_FOLDER_ID: 'staging-root',
        GOOGLE_SERVICE_ACCOUNT_EMAIL: 'service@example.iam.gserviceaccount.com',
        GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: 'private-key-shape',
        GOOGLE_TEMPLATE_DOC_ID: 'staging-template',
        INTERNAL_JOB_SECRET: 'internal-secret',
        PUBLIC_APP_ENV: 'staging',
        PUBLIC_SITE_URL: `https://${STAGING_SITE_HOST}`,
        PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
        PUBLIC_SUPABASE_URL: `https://${STAGING_SUPABASE_REF}.supabase.co`,
        RESEND_API_KEY: 'resend-key',
        STRIPE_SECRET_KEY: 'sk_test_example',
        SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
        TEST_ADMIN_EMAIL: 'admin@example.com',
        TEST_ADMIN_PASSWORD: 'admin-password',
        TEST_STUDENT_EMAIL: 'student@example.com',
        TEST_TEACHER_EMAIL: 'teacher@example.com',
        TEST_TEACHER_PASSWORD: 'teacher-password',
    };
}

describe('focused staging integration safety gates', () => {
    it('defaults to a read-only preflight', () => {
        const args = parseRunnerArgs([]);
        expect(args).toEqual({
            envFile: '.env.staging',
            execute: false,
            sendOneEmail: false,
        });

        expect(() => validateStagingGates({ args, env: stagingEnv(), workspaceRoot })).toThrow(
            '--expected-web-version-id',
        );
        const gate = validateStagingGates({ args: approvedArgs(), env: stagingEnv(), workspaceRoot });
        expect(gate.baseHost).toBe(STAGING_SITE_HOST);
        expect(gate.dailyEmailLimit).toBe(10);
        expect(gate.monthlyEmailLimit).toBe(100);
        expect(() => parseRunnerArgs(['--execute', '--dry-run'])).toThrow('cannot be combined');
    });

    it('rejects legacy preview aliases now that staging uses one canonical custom domain', () => {
        const previewHost = 'rc-20260710-espanolhonesto-staging.alindev95.workers.dev';
        const args = approvedArgs([
            '--base-url', `https://${previewHost}`,
            '--execute',
            '--send-one-email',
            '--confirmation', `writes-ok:${previewHost}`,
        ]);

        expect(() => validateStagingGates({ args, env: stagingEnv(), workspaceRoot })).toThrow(
            'approved staging Worker host',
        );
    });

    it('rejects production-like service targets and unsafe email posture', () => {
        const args = approvedArgs();
        expect(() => validateStagingGates({
            args,
            env: { ...stagingEnv(), PUBLIC_SUPABASE_URL: 'https://production.supabase.co' },
            workspaceRoot,
        })).toThrow('approved staging project');
        expect(() => validateStagingGates({
            args: { ...args, baseUrl: 'https://espanolhonesto.com' },
            env: stagingEnv(),
            workspaceRoot,
        })).toThrow('approved staging Worker host');
        expect(() => validateStagingGates({
            args,
            env: { ...stagingEnv(), EMAIL_DELIVERY_MODE: 'live' },
            workspaceRoot,
        })).toThrow('must be allowlist');
        expect(() => validateStagingGates({
            args,
            env: { ...stagingEnv(), EMAIL_DAILY_RECIPIENT_LIMIT: '11' },
            workspaceRoot,
        })).toThrow('between 1 and 10');
    });

    it('only accepts the workspace .env.staging file and all three allowlisted test users', () => {
        const args = approvedArgs(['--env-file', '.env']);
        expect(() => validateStagingGates({ args, env: stagingEnv(), workspaceRoot })).toThrow(
            'Only the workspace .env.staging file is allowed',
        );

        const env = stagingEnv();
        env.EMAIL_RECIPIENT_ALLOWLIST = 'admin@example.com,teacher@example.com';
        expect(() => validateStagingGates({
            args: approvedArgs(),
            env,
            workspaceRoot,
        })).toThrow('TEST_STUDENT_EMAIL must be in EMAIL_RECIPIENT_ALLOWLIST');
        expect(path.basename(parseRunnerArgs([]).envFile)).toBe('.env.staging');
    });

    it('refuses cleanup outside the exact staging Drive root or marker', () => {
        const candidate = {
            mimeType: 'application/vnd.google-apps.folder',
            name: 'SMOKE-INTEGRATION-123 - test user',
            parents: ['staging-root'],
        };
        expect(() => assertDriveCleanupTarget(candidate, 'staging-root', 'SMOKE-INTEGRATION-123')).not.toThrow();
        expect(() => assertDriveCleanupTarget(candidate, 'production-root', 'SMOKE-INTEGRATION-123')).toThrow(
            'outside the staging root',
        );
        expect(() => assertDriveCleanupTarget(candidate, 'staging-root', 'another-marker')).toThrow(
            'does not contain the smoke marker',
        );
    });

    it('refuses Calendar cleanup unless marker, organizer and start all match', () => {
        const scheduledAt = '2026-07-20T10:00:00.000Z';
        const candidate = {
            summary: 'Clase de Español - SMOKE-INTEGRATION-123',
            organizer: { email: 'owner@example.com' },
            start: { dateTime: scheduledAt },
        };
        const expected = {
            marker: 'SMOKE-INTEGRATION-123',
            organizerEmail: 'owner@example.com',
            scheduledAt,
        };
        expect(() => assertCalendarCleanupTarget(candidate, expected)).not.toThrow();
        expect(() => assertCalendarCleanupTarget(
            { ...candidate, organizer: { email: 'other@example.com' } },
            expected,
        )).toThrow('unexpected organizer');
        expect(() => assertCalendarCleanupTarget(
            { ...candidate, start: { dateTime: '2026-07-21T10:00:00.000Z' } },
            expected,
        )).toThrow('unexpected start time');
    });

    it('keeps provider writes focused and disables automatic fulfillment emails', () => {
        expect(runnerSource).not.toContain('/api/email/send-test');
        expect(runnerSource).toContain('/api/internal/staging-integration-email');
        expect(runnerSource).toContain('/internal/jobs/process-exact');
        expect(runnerSource).not.toContain("'/internal/jobs/process'");
        expect(runnerSource).not.toContain('processOneJob');
        expect(runnerSource.match(/sendEmail: false/g)?.length).toBeGreaterThanOrEqual(2);
        expect(runnerSource.match(/smokeRunId:/g)?.length).toBeGreaterThanOrEqual(2);
        expect(runnerSource).toContain("const NEVER_DUE_RUN_AT = '2099-01-01T00:00:00.000Z'");
        expect(runnerSource).toContain("requestBody: { trashed: true }");
        expect(runnerSource).toContain("sendUpdates: 'all'");
        expect(runnerSource).toContain('await cleanupSmoke(');
        expect(runnerSource).not.toContain('stripe.customers');
        expect(runnerSource).not.toContain('stripe.subscriptions');
    });
});
